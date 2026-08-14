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
): Promise<void> {
  try {
    const verdict = await scoreDestination(destination);
    if (!verdict) return;
    // Only if the row still points where the lookup went. A destination edit
    // clears the verdict and starts its own scan, and the lookup it replaced
    // can still be in flight: without this, the older answer lands afterwards
    // and labels the new destination with the old one's verdict. Two edits in
    // quick succession are the same race with both scans in flight.
    await db
      .prepare(
        `update links set risk_score = ?, risk_reasons = ?, risk_checked_at = ?, risk_provider = ?
         where id = ? and destination = ?`,
      )
      .bind(
        verdict.score,
        JSON.stringify(verdict.reasons),
        Date.now(),
        verdict.provider,
        linkId,
        destination,
      )
      .run();
  } catch (error) {
    console.warn("risk_score_failed", linkId, error);
  }
}

/**
 * Re-scores links, oldest first, with never-scored ones taking priority.
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
  // Half the batch at most for the never-scored, so they cannot crowd out the
  // rescans. A destination the resolver keeps timing out on stays unscored,
  // and unscored sorts first: enough of those and every run spends its whole
  // budget retrying the same failures, while destinations that were clean a
  // year ago are never looked at again. That is the sweep quietly giving up
  // on the job it exists for, with nothing on screen to say so.
  // Together: two independent reads of our own database, which is not the
  // resolver the loop below is careful with.
  const [unscored, scored] = await Promise.all([
    pickToScore(db, "risk_checked_at is null", batchSize),
    pickToScore(db, "risk_checked_at is not null", batchSize),
  ]);
  // The cap gives way when the other side cannot fill the batch: it exists to
  // stop the unscored crowding out rescans, not to leave the budget unspent.
  const room = Math.max(Math.ceil(batchSize / 2), batchSize - scored.length);
  const take = unscored.slice(0, room);
  const results = [...take, ...scored.slice(0, batchSize - take.length)];

  // react-doctor-disable-next-line react-doctor/async-await-in-loop
  for (const row of results) await scoreAndRecord(db, row.id, row.destination);
  return results.length;
}

/** One side of the sweep's batch: the oldest rows in the given state. */
async function pickToScore(
  db: D1Database,
  state: string,
  limit: number,
): Promise<{ id: string; destination: string }[]> {
  if (limit <= 0) return [];
  const { results } = await db
    .prepare(
      `select id, destination from links
       where ${state}
       order by risk_checked_at asc
       limit ?`,
    )
    .bind(limit)
    .all<{ id: string; destination: string }>();
  return results;
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
