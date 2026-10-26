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

/** What Web Risk needs: its key, the KV namespace its answers are cached in,
 * and D1 for the daily cap. Without `LINKS` (unit tests) every lookup goes to
 * Google; without `DB` none is counted. */
export type WebRiskEnv = Pick<Env, "WEB_RISK_API_KEY"> & Partial<Pick<Env, "LINKS" | "DB">>;

/** Asked before each call to Google that the cache did not answer. False
 * means the caller is out of lookups for today (destination-check.ts). */
export type SpendLookup = () => Promise<boolean>;

/** A combined verdict, or null for "still unscored", and what Web Risk said
 * on its own, which the null can hide. */
export type ScoredDestination = { verdict: RiskVerdict | null; webRisk: WebRiskOutcome };

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
  env: WebRiskEnv = {},
): Promise<RiskVerdict | null> {
  return (await scoreDestinationWithWebRisk(destination, env)).verdict;
}

/** scoreDestination, plus Web Risk's own outcome, for a caller that stamps
 * `web_risk_checked_at` or logs what Google said. */
export async function scoreDestinationWithWebRisk(
  destination: string,
  env: WebRiskEnv,
  spendLookup?: SpendLookup,
): Promise<ScoredDestination> {
  const [dns, webRisk] = await Promise.all([
    dnsVerdict(destination),
    askWebRisk(env, destination, spendLookup),
  ]);
  const answered = [dns, webRisk.verdict].filter((verdict) => verdict !== null);
  if (answered.length === 0) return { verdict: null, webRisk: webRisk.outcome };
  return {
    verdict: {
      score: Math.max(...answered.map((a) => a.score)),
      reasons: answered.flatMap((a) => a.reasons),
      provider: answered.map((a) => a.provider).join("+"),
    },
    webRisk: webRisk.outcome,
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
  threat: v.optional(
    v.object({
      threatTypes: v.optional(v.array(v.string()), []),
      expireTime: v.optional(v.string()),
    }),
  ),
});

/**
 * The longest URI sent to Google. The URI rides in the query string of a GET:
 * a 9 KB one still reached Google's auth in a probe, and a 17 KB one got a
 * 400. Destinations have no length cap, so without this a long enough query
 * string was a way past the check. 8 KB leaves room for the rest of the GET.
 *
 * Measured encoded, as the URI is sent (webRiskUriLength): each "&" or "%"
 * grows to three characters or five, so 8,000 of them pass a check on the raw
 * URL and still make a 24 KB request that Google refuses.
 */
export const WEB_RISK_MAX_URI = 8 * 1024;

/** How long a URI is once it is a query parameter of the lookup. */
export function webRiskUriLength(uri: string): number {
  return new URLSearchParams({ uri }).toString().length - "uri=".length;
}
/** Web Risk matches the host plus up to four path prefixes ("/", "/a/",
 * "/a/b/", "/a/b/c/"), so three leading segments keep every prefix check. */
const WEB_RISK_PATH_SEGMENTS = 3;

/**
 * What Google is asked about for a destination, or null if it is not an
 * http(s) URL.
 *
 * No fragment (the browser never sends it) and no user:password, which is
 * nobody's business at Google. The query stays when it fits, because Web
 * Risk also matches a path with its exact query. Past WEB_RISK_MAX_URI the
 * query goes, which still leaves the host and path expressions Web Risk
 * matches; past it again, the path is cut to its leading segments.
 */
export function webRiskUri(destination: string): string | null {
  if (!hostnameOf(destination)) return null;
  const url = new URL(destination);
  url.hash = "";
  url.username = "";
  url.password = "";
  const fits = (uri: string) => webRiskUriLength(uri) <= WEB_RISK_MAX_URI;
  if (fits(url.href)) return url.href;
  url.search = "";
  if (fits(url.href)) return url.href;
  // Not the bare host: padding a listed path past the cap would then get a
  // clean answer for the host. The leading segments still carry the listed
  // prefix, and only padding inside the first one (a path nobody listed)
  // leaves just the host.
  const segments = url.pathname.split("/").filter(Boolean).slice(0, WEB_RISK_PATH_SEGMENTS);
  for (; segments.length > 0; segments.pop()) {
    const uri = `${url.origin}/${segments.join("/")}/`;
    if (fits(uri)) return uri;
  }
  return `${url.origin}/`;
}

/** How long a clean answer is reused. Short: a site can be listed any time,
 * and this only exists so repeating a lookup costs nothing. */
const WEB_RISK_CLEAN_TTL_SECONDS = 60 * 60;
/**
 * A listed answer's life: Google's `expireTime`, or 30 minutes when it gave
 * none, since Google's terms (Service Specific Terms §47) allow acting on a
 * Web Risk answer only while it is that fresh. That bounds when a hit can
 * start a hold. The hold itself is a human-review state: it stays until an
 * admin acts, the way Bitly's review does, and nothing asks Google again
 * about a held link.
 */
const WEB_RISK_HIT_TTL_SECONDS = { max: 24 * 60 * 60, fallback: 30 * 60 };
/** KV refuses a TTL under 60 seconds: an answer due to expire sooner is not
 * cached at all, rather than kept past its expiry. */
const KV_MIN_TTL_SECONDS = 60;
/** KV's edge cache can serve a value up to about 60 seconds after it expired,
 * so a hit is cached for that much less than Google's life for it. */
const KV_EDGE_STALE_SECONDS = 60;

type WebRiskAnswer = { verdict: RiskVerdict; ttlSeconds: number };

/** How long to keep a listed answer: until Google's expireTime, inside the
 * bounds, or the fallback when it gave none we can read. */
function hitTtlSeconds(expireTime: string | undefined): number {
  const { max, fallback } = WEB_RISK_HIT_TTL_SECONDS;
  const expires = Date.parse(expireTime ?? "");
  const life = Number.isNaN(expires) ? fallback : Math.floor((expires - Date.now()) / 1000);
  return Math.min(max, life) - KV_EDGE_STALE_SECONDS;
}

/** Calls to Google a day, site-wide. Google lists no per-day quota for the
 * Lookup API, and the free tier is 100,000 calls a month: 3,000 a day stays
 * under it in a 31-day month. */
export const WEB_RISK_LOOKUPS_PER_DAY = 3_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today, as days since the epoch (UTC): the key of `web_risk_usage`. */
export const webRiskDay = (now = Date.now()) => Math.floor(now / DAY_MS);

/**
 * Takes one call from today's site-wide allowance. False once the day has
 * spent WEB_RISK_LOOKUPS_PER_DAY: the upsert's WHERE skips the update, and
 * RETURNING then gives no row. One statement, so two Workers asking at once
 * cannot both take the last call.
 */
export async function takeWebRiskLookup(d1: D1Database, now = Date.now()): Promise<boolean> {
  const row = await d1
    .prepare(
      `insert into web_risk_usage (day, lookups) values (?1, 1)
       on conflict (day) do update set lookups = lookups + 1 where lookups < ?2
       returning lookups`,
    )
    .bind(webRiskDay(now), WEB_RISK_LOOKUPS_PER_DAY)
    .first();
  return row !== null;
}

/** One call to Google for an already-canonical URI, counted against the
 * day's cap when given D1. Null when the cap is spent, as when Google does
 * not answer: every caller already has a path for that. */
async function lookupWebRisk(
  uri: string,
  key: string,
  d1?: D1Database,
): Promise<WebRiskAnswer | null> {
  const params = new URLSearchParams({ uri });
  for (const threat of WEB_RISK_THREATS) params.append("threatTypes", threat);
  try {
    if (d1 && !(await takeWebRiskLookup(d1))) return null;
    const res = await fetch(`${WEB_RISK_SEARCH}?${params}`, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = v.safeParse(webRiskAnswerSchema, await res.json());
    return parsed.success ? readWebRiskAnswer(parsed.output) : null;
  } catch {
    return null;
  }
}

/** A verdict from Google's parsed answer, and how long it may be reused. */
function readWebRiskAnswer({ threat }: v.InferOutput<typeof webRiskAnswerSchema>): WebRiskAnswer {
  const threats = threat?.threatTypes ?? [];
  const listed = threats.length > 0;
  return {
    verdict: {
      score: listed ? 100 : 0,
      reasons: threats.map((t) => `${WEB_RISK_REASON_PREFIX}${t.toLowerCase()}`),
      provider: RISK_PROVIDER_WEB_RISK,
    },
    ttlSeconds: listed ? hitTtlSeconds(threat?.expireTime) : WEB_RISK_CLEAN_TTL_SECONDS,
  };
}

/**
 * Asks Google Web Risk whether a URL is on one of its threat lists, or null
 * when it did not answer in time or answered something we do not recognise.
 * Uncached: askWebRisk is what the app calls.
 *
 * The key goes in a header, not the query string, so it stays out of any log
 * that records URLs. The Lookup API has no "borderline" answer: a URL is on a
 * list or it is not, so there is nothing here for the warning tier.
 */
export async function webRiskVerdict(
  destination: string,
  key: string,
  d1?: D1Database,
): Promise<RiskVerdict | null> {
  const uri = webRiskUri(destination);
  return uri ? ((await lookupWebRisk(uri, key, d1))?.verdict ?? null) : null;
}

/**
 * What Web Risk said about one lookup, for the wide event. "failed" is the
 * one a null verdict hides: Google errored, timed out or answered a shape we
 * do not read, and the DNS check stood alone. "over_budget" means the org had
 * spent its lookups for the day and nobody asked. "off" means no key is set.
 */
export type WebRiskOutcome = "hit" | "clean" | "failed" | "over_budget" | "off";

/** Whether Google gave an answer, which is what stamps web_risk_checked_at. */
export function webRiskAnswered(outcome: WebRiskOutcome): boolean {
  return outcome === "hit" || outcome === "clean";
}

/** The KV key a URI's answer is cached under: a hash, so a long URL makes a
 * short key and no destination is readable in a key listing. */
async function webRiskCacheKey(uri: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uri));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `webrisk:${hex}`;
}

/**
 * Web Risk's answer for a destination: from the cache when the same URI was
 * asked about recently, otherwise from Google, if `spendLookup` (when given)
 * allows another call today. Never throws.
 *
 * The cache is what makes flipping a link between two URLs cheap for us
 * rather than for Google's quota: each URI costs one call per TTL, however
 * often it comes back.
 */
export async function askWebRisk(
  env: WebRiskEnv,
  destination: string,
  spendLookup?: SpendLookup,
): Promise<{ verdict: RiskVerdict | null; outcome: WebRiskOutcome }> {
  const key = env.WEB_RISK_API_KEY;
  if (!key) return { verdict: null, outcome: "off" };
  const uri = webRiskUri(destination);
  if (!uri) return { verdict: null, outcome: "failed" };
  const answered = (verdict: RiskVerdict) => ({
    verdict,
    outcome: isWebRiskHit(verdict) ? ("hit" as const) : ("clean" as const),
  });
  try {
    const cacheKey = await webRiskCacheKey(uri);
    const cached = await env.LINKS?.get<RiskVerdict>(cacheKey, "json");
    if (cached) return answered(cached);
    if (spendLookup && !(await spendLookup())) return { verdict: null, outcome: "over_budget" };
    const answer = await lookupWebRisk(uri, key, env.DB);
    if (!answer) return { verdict: null, outcome: "failed" };
    // Its own catch: KV refuses a second write to one key within a second,
    // and losing the cache entry must not lose Google's answer with it.
    if (answer.ttlSeconds >= KV_MIN_TTL_SECONDS)
      await env.LINKS?.put(cacheKey, JSON.stringify(answer.verdict), {
        expirationTtl: answer.ttlSeconds,
      }).catch(() => {});
    return answered(answer.verdict);
  } catch {
    return { verdict: null, outcome: "failed" };
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
 * `webRisk` is what Google said either way, for the caller's wide event.
 */
export async function scoreAndRecord(
  env: Pick<Env, "DB"> & WebRiskEnv,
  linkId: string,
  destination: string,
  /** Which table the row lives in. The anonymous shortener (Direction A of
   * #96) keeps its links in `anon_links`, with the same four columns and the
   * same rules, so it shares this function rather than copying it. */
  table: "links" | "anon_links" = "links",
  spendLookup?: SpendLookup,
): Promise<ScoredDestination> {
  let webRisk: WebRiskOutcome = "failed";
  try {
    const scored = await scoreDestinationWithWebRisk(destination, env, spendLookup);
    const { verdict } = scored;
    webRisk = scored.webRisk;
    if (!verdict) return { verdict: null, webRisk };
    // Only `links` has the column: anonymous links expire in a day, so the
    // weekly rescan never looks at them.
    const stampWebRisk = table === "links" && webRiskAnswered(webRisk);
    // Only if the row still points where the lookup went. A destination edit
    // clears the verdict and starts its own scan, and the lookup it replaced
    // can still be in flight: without this, the older answer lands afterwards
    // and labels the new destination with the old one's verdict. Two edits in
    // quick succession are the same race with both scans in flight.
    const now = Date.now();
    const result = await env.DB.prepare(
      `update ${table} set risk_score = ?, risk_reasons = ?, risk_checked_at = ?, risk_provider = ?${stampWebRisk ? ", web_risk_checked_at = ?" : ""}
         where id = ? and destination = ?`,
    )
      .bind(
        verdict.score,
        JSON.stringify(verdict.reasons),
        now,
        verdict.provider,
        ...(stampWebRisk ? [now] : []),
        linkId,
        destination,
      )
      .run();
    return { verdict: result.meta.changes > 0 ? verdict : null, webRisk };
  } catch (error) {
    console.warn("risk_score_failed", linkId, error);
    return { verdict: null, webRisk };
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
