import * as Sentry from "@sentry/cloudflare";
import type { Context, Next } from "hono";
import type { JsonValue } from "../shared/types";
import { optionalText, parseOptionalBody } from "./schemas";
import * as v from "valibot";
import type { AppEnv, Env, SessionUser } from "./env";
import { logFailure } from "./log-failure";

const RATE_LIMIT_WINDOW_SECONDS = 60;

// One binding counts them all: a call spends RATE_LIMIT_POOL / limit units, so each
// bucket allows exactly its limit. email_recipient is tight on purpose (#50).
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

/** The digest is the only form an identifier takes once it leaves the request. */
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

/** The HMAC output exists only in Cloudflare's rate-limit counter: no IP in storage or logs. */
export async function publicClientKey(request: Request, secret: string): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("cf-connecting-ip") ?? forwarded ?? "unknown";
  return keyedDigest(secret, address);
}

/**
 * Cloudflare's connecting address only, never x-forwarded-for, which a caller
 * writes. Undefined without one, so the click uses the org's shared bucket.
 */
export async function clickVisitorKey(
  request: Request,
  secret: string,
): Promise<string | undefined> {
  const address = request.headers.get("cf-connecting-ip");
  return address ? keyedDigest(secret, address) : undefined;
}

/**
 * Clones before reading: BetterAuth gets `c.req.raw` afterwards and needs its
 * body stream untouched. No readable `email` yields null: no recipient to protect.
 */
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

  // Counted against the recipient (#50): distributed callers each stay under the
  // per-caller limit while one address absorbs them all. Deliberately the same 429:
  // telling which budget ran out would answer "does this address exist?".
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

/** Same counter and key as the auth routes, for mail sent outside /api/auth/* (#15). */
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
  // Each GET mints a Polar customer session and makes up to nine more Polar calls, all on the
  // one organization token Polar rate-limits.
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
    // Separate counters (the key starts with the group), so invoices never use up checkout's budget.
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
 * `visitor` splits the bucket per visitor: one bucket for the whole org let one
 * flooder drop every other visitor's clicks for the window.
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
