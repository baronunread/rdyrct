/**
 * It scores, it does not block: false positives are expensive, so a human stays in the loop
 * (#68). Cloudflare's security resolver answers 0.0.0.0 for known bad domains; it is not a
 * documented feed, so an unrecognised answer leaves the row unscored. Web Risk (#341) holds links.
 */
import * as v from "valibot";
import type { Env } from "./env";
import { stripUtmParams } from "./util";
import { logFailure } from "./log-failure";

export type RiskVerdict = {
  score: number;
  reasons: string[];
  provider: string;
};

export const RISK_PROVIDER_DNS = "cloudflare-security-dns";
export const RISK_PROVIDER_WEB_RISK = "google-web-risk";
const RESOLVER = "https://security.cloudflare-dns.com/dns-query";
const LOOKUP_TIMEOUT_MS = 3000;

const BLOCKED_ANSWERS = new Set(["0.0.0.0", "::"]);

type DnsJson = {
  Status?: number;
  Answer?: { data?: string }[];
};

/** Without `LINKS` (unit tests) every lookup goes to Google; without `DB` none is counted. */
export type WebRiskEnv = Pick<Env, "WEB_RISK_API_KEY"> & Partial<Pick<Env, "LINKS" | "DB">>;

/** False means the caller is out of lookups for today. */
export type SpendLookup = () => Promise<boolean>;

export type ScoredDestination = { verdict: RiskVerdict | null; webRisk: WebRiskOutcome };

/**
 * Null is not "clean": a timeout, an unrecognised shape or an outage all land here and
 * the row keeps a null score for the cron. Without `env` (the redirect path's
 * revalidation) only the DNS check runs: Web Risk's free tier is counted per lookup.
 */
export async function scoreDestination(
  destination: string,
  env: WebRiskEnv = {},
): Promise<RiskVerdict | null> {
  return (await scoreDestinationWithWebRisk(destination, env)).verdict;
}

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

  // Status 3 is NXDOMAIN: a dead link, not a dangerous one. Scoring it would flag every typo.
  if (json.Status === 3) return { score: 0, reasons: [], provider: RISK_PROVIDER_DNS };
  if (json.Status !== 0 || !Array.isArray(json.Answer)) return null;

  const blocked = json.Answer.some((a) => a.data && BLOCKED_ANSWERS.has(a.data));
  return {
    score: blocked ? 100 : 0,
    reasons: blocked ? ["dns_blocklist"] : [],
    provider: RISK_PROVIDER_DNS,
  };
}

const WEB_RISK_SEARCH = "https://webrisk.googleapis.com/v1/uris:search";
const WEB_RISK_THREATS = ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"];
/** Every Web Risk reason starts with this, which tells a hit from a DNS block. */
const WEB_RISK_REASON_PREFIX = "web_risk_";

const webRiskAnswerSchema = v.object({
  threat: v.optional(
    v.object({
      threatTypes: v.optional(v.array(v.string()), []),
      expireTime: v.optional(v.string()),
    }),
  ),
});

/**
 * The URI rides in a GET query string: a 9 KB one reached Google's auth, a 17 KB one got a
 * 400, and destinations have no length cap. Measured encoded (webRiskUriLength), where each
 * "&" or "%" grows to three or five characters.
 */
export const WEB_RISK_MAX_URI = 8 * 1024;

export function webRiskUriLength(uri: string): number {
  return new URLSearchParams({ uri }).toString().length - "uri=".length;
}
/** Web Risk matches the host plus up to four path prefixes, so three leading segments keep every prefix check. */
const WEB_RISK_PATH_SEGMENTS = 3;

/**
 * No fragment (the browser never sends it) and no user:password. Past WEB_RISK_MAX_URI the
 * query goes, then the path is cut to its leading segments.
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
  // Not the bare host: padding a listed path past the cap would get a clean answer for the host.
  const segments = url.pathname.split("/").filter(Boolean).slice(0, WEB_RISK_PATH_SEGMENTS);
  for (; segments.length > 0; segments.pop()) {
    const uri = `${url.origin}/${segments.join("/")}/`;
    if (fits(uri)) return uri;
  }
  return `${url.origin}/`;
}

/** Short: a site can be listed any time. */
const WEB_RISK_CLEAN_TTL_SECONDS = 60 * 60;
/**
 * Google's `expireTime`, or 30 minutes: Google's terms (Service Specific Terms §47) allow
 * acting on a Web Risk answer only while fresh. The hold itself stays until an admin acts.
 */
const WEB_RISK_HIT_TTL_SECONDS = { max: 24 * 60 * 60, fallback: 30 * 60 };
/** KV refuses a TTL under 60 seconds: such an answer is not cached. */
const KV_MIN_TTL_SECONDS = 60;
/** KV's edge cache can serve a value up to about 60 seconds past expiry. */
const KV_EDGE_STALE_SECONDS = 60;

type WebRiskAnswer = { verdict: RiskVerdict; ttlSeconds: number };

function hitTtlSeconds(expireTime: string | undefined): number {
  const { max, fallback } = WEB_RISK_HIT_TTL_SECONDS;
  const expires = Date.parse(expireTime ?? "");
  const life = Number.isNaN(expires) ? fallback : Math.floor((expires - Date.now()) / 1000);
  return Math.min(max, life) - KV_EDGE_STALE_SECONDS;
}

/** Google lists no per-day quota; the free tier is 100,000 a month, and 3,000 a day fits a 31-day month. */
export const WEB_RISK_LOOKUPS_PER_DAY = 3_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const webRiskDay = (now = Date.now()) => Math.floor(now / DAY_MS);

/** One statement, so two Workers asking at once cannot both take the last call. */
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

async function lookupWebRisk(
  uri: string,
  key: string,
  d1?: D1Database,
): Promise<WebRiskAnswer | "capped" | null> {
  const params = new URLSearchParams({ uri });
  for (const threat of WEB_RISK_THREATS) params.append("threatTypes", threat);
  try {
    if (d1 && !(await takeWebRiskLookup(d1))) return "capped";
    const res = await fetch(`${WEB_RISK_SEARCH}?${params.toString()}`, {
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

/** The key goes in a header so it stays out of URL logs. There is no "borderline" answer for the warning tier. */
export async function webRiskVerdict(
  destination: string,
  key: string,
  d1?: D1Database,
): Promise<RiskVerdict | null> {
  const uri = webRiskUri(destination);
  const answer = uri ? await lookupWebRisk(uri, key, d1) : null;
  return answer && answer !== "capped" ? answer.verdict : null;
}

/** "failed" is the one a null verdict hides. "over_budget": the org spent its day. "capped": the whole site did. */
export type WebRiskOutcome = "hit" | "clean" | "failed" | "over_budget" | "capped" | "off";

export function webRiskAnswered(outcome: WebRiskOutcome): boolean {
  return outcome === "hit" || outcome === "clean";
}

/** A hash: no destination is readable in a key listing. */
async function webRiskCacheKey(uri: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uri));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `webrisk:${hex}`;
}

/** The cache makes each URI cost one call per TTL, however often it comes back. Never throws. */
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
    if (answer === "capped") return { verdict: null, outcome: "capped" };
    if (!answer) return { verdict: null, outcome: "failed" };
    // Its own catch: KV refuses a second write to a key within a second, and that must not lose Google's answer.
    if (answer.ttlSeconds >= KV_MIN_TTL_SECONDS)
      await env.LINKS?.put(cacheKey, JSON.stringify(answer.verdict), {
        expirationTtl: answer.ttlSeconds,
      }).catch(() => {});
    return answered(answer.verdict);
  } catch {
    return { verdict: null, outcome: "failed" };
  }
}

export function isWebRiskHit(verdict: RiskVerdict): boolean {
  return verdict.reasons.some((r) => r.startsWith(WEB_RISK_REASON_PREFIX));
}

export function webRiskThreats(verdict: RiskVerdict): string[] {
  return verdict.reasons
    .filter((r) => r.startsWith(WEB_RISK_REASON_PREFIX))
    .map((r) => r.slice(WEB_RISK_REASON_PREFIX.length).replaceAll("_", " "));
}

/**
 * Meant for `waitUntil`; every failure leaves the row unscored, first in the cron's queue.
 * Returns null when it wrote nothing (no answer, or the destination changed mid-lookup):
 * a caller acting on the verdict must not act on one that was not written.
 */
export async function scoreAndRecord(
  env: Pick<Env, "DB"> & WebRiskEnv,
  linkId: string,
  destination: string,
  /** `anon_links` has the same four columns and rules (#96). */
  table: "links" | "anon_links" = "links",
  spendLookup?: SpendLookup,
): Promise<ScoredDestination> {
  let webRisk: WebRiskOutcome = "failed";
  try {
    const scored = await scoreDestinationWithWebRisk(destination, env, spendLookup);
    const { verdict } = scored;
    webRisk = scored.webRisk;
    if (!verdict) return { verdict: null, webRisk };
    // Anonymous links expire in a day, so the weekly rescan never reads them.
    const stampWebRisk = table === "links" && webRiskAnswered(webRisk);
    // Only if the row still points where the lookup went: an edit starts its own scan, and the
    // older in-flight answer would otherwise label the new destination.
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
    logFailure("risk_score_failed", error, { linkId });
    return { verdict: null, webRisk };
  }
}

const HOST_VERDICT_TTL_SECONDS = 24 * 60 * 60;

/**
 * Links this isolate already ran the per-click update for, to the time that run stops counting
 * (#489). A D1 read would replace the write it saves. The value holds a destination hash, so
 * an edit never inherits the old skip.
 */
const recentlyStamped = new Map<string, { until: number; destination: number }>();

/** FNV-1a, 32 bits: a collision costs at most one skipped stamp until the next window. */
function destinationHash(url: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

const STAMP_RECHECK_MS = 60 * 60 * 1000;

const STAMP_MEMO_MAX = 10_000;

function rememberStamp(linkId: string, destination: number, until: number) {
  recentlyStamped.delete(linkId);
  recentlyStamped.set(linkId, { until, destination });
  if (recentlyStamped.size > STAMP_MEMO_MAX) {
    const oldest = recentlyStamped.keys().next();
    if (!oldest.done) recentlyStamped.delete(oldest.value);
  }
}

/**
 * Replaced a nightly sweep, which loses the race on a big table. Work scales with distinct
 * hosts clicked: the verdict is cached per hostname. Meant for `waitUntil`; every failure is
 * swallowed, since a redirect must not depend on a resolver.
 */
export async function revalidateOnRedirect(
  env: Env,
  hit: { linkId: string; orgId: string; url: string },
): Promise<void> {
  // Anonymous links (#96) are checked when made and expire within 24 hours.
  if (!hit.orgId) return;

  const hostname = hostnameOf(hit.url);
  if (!hostname) return;

  try {
    const cacheKey = `risk:host:${hostname}`;
    // The whole verdict is cached, not just its score: a click on a host another link warmed must be able to record it.
    const cached = await env.LINKS.get<RiskVerdict>(cacheKey, "json");
    const verdict = cached ?? (await scoreDestination(hit.url));
    if (!verdict) return;

    // Written before the row: if the update fails, the next click should not repeat a lookup that succeeded.
    if (!cached)
      await env.LINKS.put(cacheKey, JSON.stringify(verdict), {
        expirationTtl: HOST_VERDICT_TTL_SECONDS,
      });

    // Every link on the host, not only the clicked one: otherwise the rest stayed unscored and hid
    // from the admin table, which sorts by score. A link already stamped by this isolate is skipped (#489).
    const destination = destinationHash(hit.url);
    const now = Date.now();
    const stamped = recentlyStamped.get(hit.linkId);
    if (cached && stamped && stamped.destination === destination && stamped.until > now) return;

    // The conditions keep the statement cheap, and stop a KV entry that predates an edit relabelling the link.
    const result = await env.DB.prepare(
      `update links set risk_score = ?, risk_reasons = ?, risk_checked_at = ?, risk_provider = ?
       where id = ? and destination = ? and (risk_checked_at is null or risk_checked_at < ?)`,
    )
      .bind(
        verdict.score,
        JSON.stringify(verdict.reasons),
        now,
        verdict.provider,
        hit.linkId,
        stripUtmParams(hit.url),
        now - HOST_VERDICT_TTL_SECONDS * 1000,
      )
      .run();
    // A row this wrote is fresh for the whole TTL; one left alone was scored at an unknown time, so skip only for a while.
    rememberStamp(
      hit.linkId,
      destination,
      now + (result.meta.changes > 0 ? HOST_VERDICT_TTL_SECONDS * 1000 : STAMP_RECHECK_MS),
    );
  } catch (error) {
    logFailure("risk_revalidate_failed", error, { linkId: hit.linkId });
  }
}

function hostnameOf(destination: string): string | null {
  try {
    const url = new URL(destination);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname || null;
  } catch {
    return null;
  }
}
