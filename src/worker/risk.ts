/**
 * Scoring a link's destination (#68).
 *
 * It scores, it does not block. Nobody waits on this to create a link and
 * nobody is refused by it: false positives on a shortener are expensive, so
 * a human stays in the loop. The columns it fills are read by admin routes
 * only (#67), never in an org-scoped response.
 *
 * Two providers, and every row records which of them answered:
 *
 * Cloudflare's security resolver refuses to resolve domains it knows to be
 * serving malware or phishing and answers 0.0.0.0 instead. It needs no
 * account, no key, and no billing, and it runs inside the network we are
 * already on. Its limits:
 *  - Hostname only. https://legit.example/compromised/page looks clean.
 *  - No threat type, just blocked or not, so `reasons` is coarse.
 *  - It is a public resolver, not a documented threat feed. The behaviour is
 *    stable and widely relied on, but it is not a contract, so an answer we
 *    do not recognise leaves the row unscored rather than calling it clean.
 *
 * Google Web Risk (#341) looks at the full URL and names the threat. It needs
 * `WEB_RISK_API_KEY`; unset, it is skipped and the DNS check runs alone,
 * the way an unset CAP_SECRET switches Cap off. It catches reused kits and
 * known bad sites, not a scam subdomain made this morning, which is on no
 * list yet. Unlike the DNS check, a Web Risk hit holds the link
 * (destination-check.ts): Google's list is a documented threat feed.
 */
import * as v from "valibot";
import type { Env } from "./env";
import { stripUtmParams } from "./util";

/** 0 = nothing known against it, 100 = a provider refuses to resolve it. */
export type RiskVerdict = {
  score: number;
  reasons: string[];
  provider: string;
};

export const RISK_PROVIDER_DNS = "cloudflare-security-dns";
export const RISK_PROVIDER_WEB_RISK = "google-web-risk";
const RESOLVER = "https://security.cloudflare-dns.com/dns-query";
const LOOKUP_TIMEOUT_MS = 3000;

/** The resolver's "I will not resolve this" answer. */
const BLOCKED_ANSWERS = new Set(["0.0.0.0", "::"]);

type DnsJson = {
  Status?: number;
  Answer?: { data?: string }[];
};

/** A verdict from every provider that answered, and whether Web Risk was
 * one of them, so the row can record when Web Risk last looked. */
export type ScoredVerdict = RiskVerdict & { webRiskAnswered: boolean };

/**
 * Scores one destination with every provider configured, or returns null to
 * mean "still unscored".
 *
 * Null is not "clean": a timeout, a shape we do not recognise, and a
 * provider outage all land here, and the row keeps a null score so the cron
 * picks it up again later. Only a definite answer writes a score. When one
 * provider answers and the other does not, the one answer stands.
 *
 * Without `env` (the redirect path's revalidation) only the DNS check runs:
 * that path is per click, and Web Risk's free tier is counted per lookup.
 */
export async function scoreDestination(
  destination: string,
  env: Pick<Env, "WEB_RISK_API_KEY"> = {},
): Promise<ScoredVerdict | null> {
  const key = env.WEB_RISK_API_KEY;
  const [dns, webRisk] = await Promise.all([
    dnsVerdict(destination),
    key ? webRiskVerdict(destination, key) : null,
  ]);
  const answered = [dns, webRisk].filter((verdict) => verdict !== null);
  if (answered.length === 0) return null;
  return {
    score: Math.max(...answered.map((a) => a.score)),
    reasons: answered.flatMap((a) => a.reasons),
    provider: answered.map((a) => a.provider).join("+"),
    webRiskAnswered: webRisk !== null,
  };
}

async function dnsVerdict(destination: string): Promise<RiskVerdict | null> {
  const hostname = hostnameOf(destination);
  if (!hostname) return null;

  let json: DnsJson;
  try {
    const res = await fetch(`${RESOLVER}?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    // SAFETY: Cloudflare's security resolver answers RFC 8484 JSON, and
    // dnsVerdict below reads only Status and Answer, both optional here.
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

/* ---------------- Google Web Risk (#341) ---------------- */

const WEB_RISK_SEARCH = "https://webrisk.googleapis.com/v1/uris:search";
/** The threat lists a short link could be pointing a visitor into. */
const WEB_RISK_THREATS = ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"];
/** Every reason Web Risk writes starts with this, which is how a caller tells
 * a Web Risk hit from a DNS block. */
const WEB_RISK_REASON_PREFIX = "web_risk_";

/** The Lookup API answers `{}` for a URL on no list, and `{ threat: {
 * threatTypes, expireTime } }` for one on a list. */
const webRiskAnswerSchema = v.object({
  threat: v.optional(v.object({ threatTypes: v.optional(v.array(v.string()), []) })),
});

/**
 * Asks Google Web Risk whether a URL is on one of its threat lists, or null
 * when it did not answer in time or answered something we do not recognise.
 *
 * The key goes in a header, not the query string, so it stays out of any log
 * that records URLs. The Lookup API has no "borderline" answer: a URL is on a
 * list or it is not, so there is nothing here for the warning tier.
 */
export async function webRiskVerdict(
  destination: string,
  key: string,
): Promise<RiskVerdict | null> {
  if (!hostnameOf(destination)) return null;
  const params = new URLSearchParams({ uri: destination });
  for (const threat of WEB_RISK_THREATS) params.append("threatTypes", threat);
  try {
    const res = await fetch(`${WEB_RISK_SEARCH}?${params}`, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = v.safeParse(webRiskAnswerSchema, await res.json());
    if (!parsed.success) return null;
    const threats = parsed.output.threat?.threatTypes ?? [];
    return {
      score: threats.length > 0 ? 100 : 0,
      reasons: threats.map((t) => `${WEB_RISK_REASON_PREFIX}${t.toLowerCase()}`),
      provider: RISK_PROVIDER_WEB_RISK,
    };
  } catch {
    return null;
  }
}

/** Whether a verdict carries a Web Risk hit, which holds a link. */
export function isWebRiskHit(verdict: RiskVerdict): boolean {
  return verdict.reasons.some((r) => r.startsWith(WEB_RISK_REASON_PREFIX));
}

/** The threat names in a verdict, for an admin to read: "malware". */
export function webRiskThreats(verdict: RiskVerdict): string[] {
  return verdict.reasons
    .filter((r) => r.startsWith(WEB_RISK_REASON_PREFIX))
    .map((r) => r.slice(WEB_RISK_REASON_PREFIX.length).replaceAll("_", " "));
}

/**
 * Scores one link and writes the result, swallowing every failure.
 *
 * Meant for `waitUntil`, so it runs after the response and no caller ever
 * waits on it. A provider error, a shape we do not recognise, or a row that
 * vanished mid-flight all leave the row exactly as it was: unscored, and
 * therefore first in the cron's queue next time.
 *
 * Returns the verdict it wrote, or null when it wrote nothing: no answer, or
 * a destination that changed while the lookup ran. A caller acting on the
 * verdict (destination-check.ts) must not act on one that was not written.
 */
export async function scoreAndRecord(
  env: Pick<Env, "DB" | "WEB_RISK_API_KEY">,
  linkId: string,
  destination: string,
  /** Which table the row lives in. The anonymous shortener (Direction A of
   * #96) keeps its links in `anon_links`, with the same four columns and the
   * same rules, so it shares this function rather than copying it. */
  table: "links" | "anon_links" = "links",
): Promise<ScoredVerdict | null> {
  try {
    const verdict = await scoreDestination(destination, env);
    if (!verdict) return null;
    // Only `links` has the column: anonymous links expire in a day, so the
    // weekly rescan never looks at them.
    const webRisk = table === "links" && verdict.webRiskAnswered;
    // Only if the row still points where the lookup went. A destination edit
    // clears the verdict and starts its own scan, and the lookup it replaced
    // can still be in flight: without this, the older answer lands afterwards
    // and labels the new destination with the old one's verdict. Two edits in
    // quick succession are the same race with both scans in flight.
    const now = Date.now();
    const result = await env.DB.prepare(
      `update ${table} set risk_score = ?, risk_reasons = ?, risk_checked_at = ?, risk_provider = ?${webRisk ? ", web_risk_checked_at = ?" : ""}
         where id = ? and destination = ?`,
    )
      .bind(
        verdict.score,
        JSON.stringify(verdict.reasons),
        now,
        verdict.provider,
        ...(webRisk ? [now] : []),
        linkId,
        destination,
      )
      .run();
    return result.meta.changes > 0 ? verdict : null;
  } catch (error) {
    console.warn("risk_score_failed", linkId, error);
    return null;
  }
}

/**
 * How long a hostname's verdict is trusted before the next click re-checks it.
 */
const HOST_VERDICT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Re-checks a destination when somebody clicks it, if the answer is stale.
 *
 * This replaced a nightly sweep, which was the wrong axis: a sweep has to get
 * through the whole table, so it loses the race as soon as the table is big,
 * and it spends most of its budget on links nobody visits. A link nobody
 * clicks harms nobody, so it can stay unscored.
 *
 * The work is proportional to distinct hosts being clicked, not to how many
 * links exist. Ten thousand links pointing at one host cost one check a day
 * between them, because the verdict is cached per hostname rather than per
 * link: our provider only ever looks at the hostname anyway, so this loses
 * no accuracy.
 *
 * Meant for `waitUntil` after the redirect has already been sent. Nothing
 * here is on the path of the person clicking, and every failure is
 * swallowed: a redirect must not depend on a resolver.
 */
export async function revalidateOnRedirect(
  env: Env,
  hit: { linkId: string; orgId: string; url: string },
): Promise<void> {
  // Anonymous links (#96) are checked when they are made and expire within
  // 24 hours, so there is never a stale one to catch.
  if (!hit.orgId) return;

  const hostname = hostnameOf(hit.url);
  if (!hostname) return;

  try {
    const cacheKey = `risk:host:${hostname}`;
    // One KV read is the whole cost of a click on a host checked recently,
    // and KV reads at the edge are what this hot path is already made of.
    // The whole verdict is cached, not just its score: a click on a host
    // somebody else's link warmed still has to be able to record it.
    const cached = await env.LINKS.get<RiskVerdict>(cacheKey, "json");
    const verdict = cached ?? (await scoreDestination(hit.url));
    if (!verdict) return;

    // Written before the row: if the update fails, the next click should not
    // immediately repeat a lookup that just succeeded.
    if (!cached)
      await env.LINKS.put(cacheKey, JSON.stringify(verdict), {
        expirationTtl: HOST_VERDICT_TTL_SECONDS,
      });

    // Every link on the host, not only the one that warmed the cache. The
    // verdict used to be written to the clicked link alone, so a host scored
    // 100 marked whichever link happened to be clicked while the cache was
    // cold and left every other link pointing at it unscored: the admin
    // table sorts by that score, so the rest hid in plain sight.
    //
    // The two conditions are what keep this off the hot path in practice: a
    // link already carrying this verdict is not written again, and a link
    // whose destination has moved on is not relabelled by a KV entry that
    // predates the edit.
    await env.DB.prepare(
      `update links set risk_score = ?, risk_reasons = ?, risk_checked_at = ?, risk_provider = ?
       where id = ? and destination = ? and (risk_checked_at is null or risk_checked_at < ?)`,
    )
      .bind(
        verdict.score,
        JSON.stringify(verdict.reasons),
        Date.now(),
        verdict.provider,
        hit.linkId,
        stripUtmParams(hit.url),
        Date.now() - HOST_VERDICT_TTL_SECONDS * 1000,
      )
      .run();
  } catch (error) {
    console.warn("risk_revalidate_failed", hit.linkId, error);
  }
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
