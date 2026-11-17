import * as Sentry from "@sentry/cloudflare";
import type { Context, Next } from "hono";
import type { JsonValue } from "../shared/types";
import { optionalText, parseOptionalBody } from "./schemas";
import * as v from "valibot";
import type { AppEnv, Env, SessionUser } from "./env";
import { logFailure } from "./log-failure";

const RATE_LIMIT_WINDOW_SECONDS = 60;

// Calls per key per minute. One binding counts them all: a call spends
// RATE_LIMIT_POOL / limit units, and Cloudflare passes a call while the key's
// count is below the pool, so each bucket allows exactly its limit.
// email_recipient is tight on purpose: it caps what one inbox receives (#50).
export const RATE_LIMITS = {
  auth: 30,
  email: 10,
  email_recipient: 4,
  write_free: 90,
  write_paid: 300,
  qr_upload: 20,
  domain: 30,
  billing: 10,
  click: 600,
  anon_link: 15,
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

export const RATE_LIMIT_POOL = 1800;

export type RateLimitGroup =
  | "auth"
  | "email"
  | "write"
  | "qr_upload"
  | "domain"
  | "checkout"
  | "billing_read"
  | "click"
  | "anon_link"
  | "unsubscribe";

const EMAIL_AUTH_PATHS = new Set([
  "/api/auth/sign-up/email",
  "/api/auth/email-otp/request-password-reset",
  "/api/auth/email-otp/send-verification-otp",
  "/api/auth/forget-password/email-otp",
  "/api/auth/request-password-reset",
  "/api/auth/send-verification-email",
]);

function rateLimitLog(
  event: "rate_limited" | "rate_limit_error",
  group: RateLimitGroup,
  details: { method: string; plan?: SessionUser["plan"]; error?: unknown },
) {
  logFailure(event, details.error, { group, method: details.method, plan: details.plan ?? null });
}

export async function rateLimitAllows(
  env: Env,
  bucket: RateLimitBucket,
  key: string,
  options: {
    group: RateLimitGroup;
    method: string;
    plan?: SessionUser["plan"];
    failClosed?: boolean;
  },
): Promise<boolean> {
  try {
    const { success } = await env.RATE_LIMIT.limit({
      key: `${bucket}:${key}`,
      delta: RATE_LIMIT_POOL / RATE_LIMITS[bucket],
    });
    if (!success) rateLimitLog("rate_limited", options.group, options);
    return success;
  } catch (error) {
    rateLimitLog("rate_limit_error", options.group, { ...options, error });
    Sentry.captureException(error, { extra: { group: options.group, method: options.method } });
    return !options.failClosed;
  }
}

function rateLimitedResponse(c: Context<AppEnv>, group: RateLimitGroup) {
  return c.json(
    {
      message: "Too many requests. Try again shortly.",
      code: "rate_limited",
    },
    429,
    {
      "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS),
      "Cache-Control": "no-store",
      "X-RateLimit-Group": group,
    },
  );
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Keyed HMAC over `value`. The digest is the only form an identifier takes
 * once it leaves the request: what ends up in a rate-limit counter is never
 * the address itself. */
export async function keyedDigest(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

/** Builds an ephemeral public-client key without exposing an IP address to
 * application storage or logs. The HMAC output exists only in Cloudflare's
 * rate-limit counter. */
export async function publicClientKey(request: Request, secret: string): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("cf-connecting-ip") ?? forwarded ?? "unknown";
  return keyedDigest(secret, address);
}

/** The click limiter's visitor key: Cloudflare's own connecting address only,
 * never x-forwarded-for, which a caller writes. Undefined without one, so the
 * click falls back to the org's shared bucket rather than a bucket the caller
 * can mint per request. */
export async function clickVisitorKey(
  request: Request,
  secret: string,
): Promise<string | undefined> {
  const address = request.headers.get("cf-connecting-ip");
  return address ? keyedDigest(secret, address) : undefined;
}

/**
 * The address an email-sending auth route would deliver to, hashed, or null
 * when the request names none.
 *
 * Clones before reading: BetterAuth is handed `c.req.raw` afterwards and
 * needs its body stream untouched. A body we can't read (missing, not JSON,
 * no `email`) yields null and the recipient limit simply doesn't apply,
 * since there is no recipient to protect.
 */
/** The one field the recipient budget is keyed on. */
const recipientBodySchema = v.object({ email: optionalText });

async function recipientKey(request: Request, secret: string): Promise<string | null> {
  let parsed: JsonValue;
  try {
    parsed = await request.clone().json();
  } catch {
    return null;
  }
  const { email } = parseOptionalBody(recipientBodySchema, parsed);
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return keyedDigest(secret, normalized);
}

export function publicAuthGroup(path: string): "auth" | "email" | null {
  if (EMAIL_AUTH_PATHS.has(path)) return "email";
  if (
    path.startsWith("/api/auth/") &&
    path !== "/api/auth/get-session" &&
    path !== "/api/auth/sign-out"
  )
    return "auth";
  return null;
}

export async function enforcePublicAuthRateLimit(c: Context<AppEnv>): Promise<Response | null> {
  const group = publicAuthGroup(c.req.path);
  if (!group) return null;
  const client = await publicClientKey(c.req.raw, c.env.BETTER_AUTH_SECRET);
  const allowed = await rateLimitAllows(c.env, group, `${c.req.path}:${client}`, {
    group,
    method: c.req.method,
  });
  if (!allowed) return rateLimitedResponse(c, group);

  // Second, independent budget for the routes that put mail in someone's
  // inbox, counted against the recipient instead of the caller (#50). The
  // per-caller limit above does nothing when the callers are many and the
  // target is one: distributed requests each stay under it while the same
  // address absorbs all of them.
  //
  // Deliberately the same 429 as the caller limit: which budget ran out is
  // not something an anonymous caller gets to learn, or asking "did this
  // address just get throttled?" would answer "does this address exist?".
  if (group === "email") {
    const recipient = await recipientKey(c.req.raw, c.env.BETTER_AUTH_SECRET);
    if (recipient) {
      const withinRecipientBudget = await rateLimitAllows(c.env, "email_recipient", recipient, {
        group,
        method: c.req.method,
      });
      if (!withinRecipientBudget) return rateLimitedResponse(c, group);
    }
  }
  return null;
}

/**
 * Spends one unit of an address's email budget (#50), for mail the app sends
 * outside /api/auth/* (#15). The same counter and key the auth routes use, so
 * an inbox gets at most the email_recipient limit a minute from all of them
 * together.
 */
export async function recipientEmailAllowed(env: Env, address: string): Promise<boolean> {
  const recipient = await keyedDigest(env.BETTER_AUTH_SECRET, address.trim().toLowerCase());
  return rateLimitAllows(env, "email_recipient", recipient, {
    group: "email",
    method: "POST",
  });
}

export function signedApiGroup(
  path: string,
  method: string,
): Exclude<RateLimitGroup, "auth" | "email" | "click" | "anon_link" | "unsubscribe"> | null {
  if (/^\/api\/billing\/(?:checkout(?:\/[^/]+\/confirm)?|portal)$/.test(path)) return "checkout";
  // GETs, but each one mints a Polar customer session and makes up to nine
  // more Polar calls, all on the one organization token Polar rate-limits.
  if (/^\/api\/billing\/(?:details|invoices\/[^/]+)$/.test(path)) return "billing_read";
  if (method === "POST" && /^\/api\/orgs\/[^/]+\/qr-logo\/?$/.test(path)) return "qr_upload";
  if (/^\/api\/orgs\/[^/]+\/domains(?:\/|$)/.test(path)) return "domain";
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")
    return "write";
  return null;
}

function orgIdFromPath(path: string): string | null {
  return /^\/api\/orgs\/([^/]+)/.exec(path)?.[1] ?? null;
}

function writeRouteFamily(path: string): string {
  if (path.includes("/links")) return "links";
  if (path.includes("/invites")) return "invites";
  if (path.startsWith("/api/admin")) return "admin";
  if (path.startsWith("/api/orgs")) return "orgs";
  return "api";
}

export function writeBucket(plan: SessionUser["plan"]): "write_free" | "write_paid" {
  return plan === "free" ? "write_free" : "write_paid";
}

export async function enforceSignedApiRateLimit(c: Context<AppEnv>, next: Next) {
  const user = c.var.user;
  const group = signedApiGroup(c.req.path, c.req.method);
  if (!user || !group) return next();

  const orgId = orgIdFromPath(c.req.path);
  const actor = orgId ? `org:${orgId}:user:${user.id}` : `user:${user.id}`;
  let bucket: RateLimitBucket;
  let key = actor;

  switch (group) {
    // Same bucket, separate counters (the key starts with the group), so
    // downloading invoices never uses up the budget for checking out.
    case "checkout":
    case "billing_read":
      bucket = "billing";
      key = `${group}:${actor}`;
      break;
    case "domain":
    case "qr_upload":
      bucket = group;
      break;
    case "write":
      bucket = writeBucket(user.plan);
      key = `${actor}:${writeRouteFamily(c.req.path)}`;
      break;
  }

  const allowed = await rateLimitAllows(c.env, bucket, key, {
    group,
    method: c.req.method,
    plan: user.plan,
  });
  if (!allowed) return rateLimitedResponse(c, group);
  return next();
}

/**
 * Whether to record one click. `visitor` (a `publicClientKey` digest, never
 * the address) splits the bucket per visitor: one bucket for the whole org let
 * one flooder spend it and drop every other visitor's clicks for the window.
 * Without it the key is the subject alone (an anonymous link's own total).
 */
export async function clickAnalyticsAllowed(
  env: Env,
  subject: string,
  method = "GET",
  visitor?: string,
): Promise<boolean> {
  const key = visitor ? `org:${subject}:${visitor}` : `org:${subject}`;
  return rateLimitAllows(env, "click", key, {
    group: "click",
    method,
    failClosed: true,
  });
}
