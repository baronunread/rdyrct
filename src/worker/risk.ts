/**
 * Scoring a link's destination (#68).
 *
 * It scores, it does not block. Nobody waits on this to create a link and
 * nobody is refused by it: false positives on a shortener are expensive, so
 * a human stays in the loop. The columns it fills are read by admin routes
 * only (#67), never in an org-scoped response.
 *
 * The provider is one function so a second one can be added without a
 * rewrite, and every row records which one answered. Today that is
 * Cloudflare's security resolver, which refuses to resolve domains it knows
 * to be serving malware or phishing and answers 0.0.0.0 instead. It needs no
 * account, no key, and no billing, and it runs inside the network we are
 * already on.
 *
 * Known limits, which are the reason `provider` is stored:
 *  - Hostname only. https://legit.example/compromised/page looks clean.
 *  - No threat type, just blocked or not, so `reasons` is coarser than a
 *    real threat API's categories would be.
 *  - It is a public resolver, not a documented threat feed. The behaviour is
 *    stable and widely relied on, but it is not a contract, so an answer we
 *    do not recognise leaves the row unscored rather than calling it clean.
 *    Google Web Risk is the upgrade for full-URL scoring, when there is
 *    evidence of that specific abuse to justify the credential.
 */

/** 0 = nothing known against it, 100 = a provider refuses to resolve it. */
export type RiskVerdict = {
  score: number;
  reasons: string[];
  provider: string;
};

export const RISK_PROVIDER_DNS = "cloudflare-security-dns";
const RESOLVER = "https://security.cloudflare-dns.com/dns-query";
const LOOKUP_TIMEOUT_MS = 3000;

/** The resolver's "I will not resolve this" answer. */
const BLOCKED_ANSWERS = new Set(["0.0.0.0", "::"]);

type DnsJson = {
  Status?: number;
  Answer?: { data?: string }[];
};

/**
 * Scores one destination, or returns null to mean "still unscored".
 *
 * Null is not "clean": a timeout, a shape we do not recognise, and a
 * provider outage all land here, and the row keeps a null score so the cron
 * picks it up again later. Only a definite answer writes a score.
 */
export async function scoreDestination(destination: string): Promise<RiskVerdict | null> {
  const hostname = hostnameOf(destination);
  if (!hostname) return null;

  let json: DnsJson;
  try {
    const res = await fetch(`${RESOLVER}?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    json = (await res.json()) as DnsJson;
  } catch {
    return null;
  }

  // Status 3 is NXDOMAIN: the name does not exist. That is a dead link, not
  // a dangerous one, and saying otherwise would score every typo as malware.
  if (json.Status === 3) return { score: 0, reasons: [], provider: RISK_PROVIDER_DNS };
  if (json.Status !== 0 || !Array.isArray(json.Answer)) return null;

  const blocked = json.Answer.some((a) => a.data && BLOCKED_ANSWERS.has(a.data));
  return {
    score: blocked ? 100 : 0,
    reasons: blocked ? ["dns_blocklist"] : [],
    provider: RISK_PROVIDER_DNS,
  };
}

/**
 * Scores one link and writes the result, swallowing every failure.
 *
 * Meant for `waitUntil`, so it runs after the response and no caller ever
 * waits on it. A provider error, a shape we do not recognise, or a row that
 * vanished mid-flight all leave the row exactly as it was: unscored, and
 * therefore first in the cron's queue next time.
 */
export async function scoreAndRecord(
  db: D1Database,
  linkId: string,
  destination: string,
  /** Which table the row lives in. The anonymous shortener (Direction A of
   * #96) keeps its links in `anon_links`, with the same four columns and the
   * same rules, so it shares this function rather than copying it. */
  table: "links" | "anon_links" = "links",
): Promise<void> {
  try {
    const verdict = await scoreDestination(destination);
    if (!verdict) return;
    await db
      .prepare(
        `update ${table} set risk_score = ?, risk_reasons = ?, risk_checked_at = ?, risk_provider = ?
         where id = ?`,
      )
      .bind(verdict.score, JSON.stringify(verdict.reasons), Date.now(), verdict.provider, linkId)
      .run();
  } catch (error) {
    console.warn("risk_score_failed", linkId, error);
  }
}

/**
 * Re-scores the least recently checked links, oldest first, nulls before
 * anything else.
 *
 * Bounded, because the whole point is that the table cycles rather than that
 * any one run finishes it: a destination that turns bad long after creation
 * is caught on some later day, and one run can never blow the daily job's
 * time budget.
 *
 * Sequential rather than parallel on purpose. This is a background sweep
 * with all day to finish, and firing a batch of lookups at a public resolver
 * at once is how you get rate limited by it.
 */
export async function sweepLinkRisk(db: D1Database, batchSize = 50): Promise<number> {
  const { results } = await db
    .prepare(
      `select id, destination from links
       order by risk_checked_at is not null, risk_checked_at asc
       limit ?`,
    )
    .bind(batchSize)
    .all<{ id: string; destination: string }>();

  // Sequential on purpose: a daily background sweep with all day to finish,
  // and firing a batch of lookups at a public resolver at once is how you get
  // rate limited by it. Promise.all would trade a slow job nobody waits on
  // for a provider that stops answering.
  // react-doctor-disable-next-line react-doctor/async-await-in-loop
  for (const row of results) await scoreAndRecord(db, row.id, row.destination);
  return results.length;
}

/** The host a destination points at, or null if it is not a URL we can read. */
function hostnameOf(destination: string): string | null {
  try {
    const url = new URL(destination);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname || null;
  } catch {
    return null;
  }
}
