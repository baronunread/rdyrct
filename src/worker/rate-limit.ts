import type { Context, Next } from "hono";
import type { AppEnv, Env, SessionUser } from "./env";

const RATE_LIMIT_WINDOW_SECONDS = 60;

export type RateLimitGroup =
  | "auth"
  | "cap"
  | "email"
  | "write"
  | "qr_upload"
  | "domain"
  | "checkout"
  | "click"
  | "anon_link";

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
  console.warn(event, group, details.method, details.plan ?? "", details.error ?? "");
}

export async function rateLimitAllows(
  binding: RateLimit,
  key: string,
  options: {
    group: RateLimitGroup;
    method: string;
    plan?: SessionUser["plan"];
    failClosed?: boolean;
  },
): Promise<boolean> {
  try {
    const { success } = await binding.limit({ key });
    if (!success) rateLimitLog("rate_limited", options.group, options);
    return success;
  } catch (error) {
    rateLimitLog("rate_limit_error", options.group, { ...options, error });
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

/**
 * The address an email-sending auth route would deliver to, hashed, or null
 * when the request names none.
 *
 * Clones before reading: BetterAuth is handed `c.req.raw` afterwards and
 * needs its body stream untouched. A body we can't read (missing, not JSON,
 * no `email`) yields null and the recipient limit simply doesn't apply,
 * since there is no recipient to protect.
 */
async function recipientKey(request: Request, secret: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = await request.clone().json();
  } catch {
    return null;
  }
  const email = (parsed as { email?: unknown } | null)?.email;
  if (typeof email !== "string") return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  return keyedDigest(secret, normalized);
}

export function publicAuthGroup(path: string): "auth" | "cap" | "email" | null {
  if (EMAIL_AUTH_PATHS.has(path)) return "email";
  // Cap's own endpoints (#98), on their own budget rather than signup's. They
  // are spent two at a time (challenge, then redeem) by every person who
  // fills the form, and when this runs out the widget cannot solve at all:
  // the browser then sends no token and the form says "could not verify you
  // are human", which is the worst possible way for a rate limit to show up.
  if (path.startsWith("/api/cap/")) return "cap";
  if (
    path.startsWith("/api/auth/") &&
    path !== "/api/auth/get-session" &&
    path !== "/api/auth/sign-out"
  )
    return "auth";
  return null;
}

/** Which counter each public group spends. */
const PUBLIC_LIMIT_BINDINGS: Record<"auth" | "cap" | "email", (env: Env) => RateLimit> = {
  auth: (env) => env.RL_AUTH_PUBLIC,
  cap: (env) => env.RL_CAP,
  email: (env) => env.RL_EMAIL,
};

export async function enforcePublicAuthRateLimit(c: Context<AppEnv>): Promise<Response | null> {
  const group = publicAuthGroup(c.req.path);
  if (!group) return null;
  const client = await publicClientKey(c.req.raw, c.env.BETTER_AUTH_SECRET);
  const binding = PUBLIC_LIMIT_BINDINGS[group](c.env);
  const allowed = await rateLimitAllows(binding, `${group}:${c.req.path}:${client}`, {
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
      const withinRecipientBudget = await rateLimitAllows(
        c.env.RL_EMAIL_RECIPIENT,
        `email-recipient:${recipient}`,
        { group, method: c.req.method },
      );
      if (!withinRecipientBudget) return rateLimitedResponse(c, group);
    }
  }
  return null;
}

export function signedApiGroup(
  path: string,
  method: string,
): Exclude<RateLimitGroup, "auth" | "cap" | "email" | "click" | "anon_link"> | null {
  if (/^\/api\/billing\/(?:checkout|portal)$/.test(path)) return "checkout";
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

export function writeRateLimitBinding(env: Env, plan: SessionUser["plan"]): RateLimit {
  return plan === "free" ? env.RL_WRITE_FREE : env.RL_WRITE_PAID;
}

export async function enforceSignedApiRateLimit(c: Context<AppEnv>, next: Next) {
  const user = c.var.user;
  const group = signedApiGroup(c.req.path, c.req.method);
  if (!user || !group) return next();

  const orgId = orgIdFromPath(c.req.path);
  const actor = orgId ? `org:${orgId}:user:${user.id}` : `user:${user.id}`;
  let binding: RateLimit;
  let key = `${group}:${actor}`;

  switch (group) {
    case "checkout":
      binding = c.env.RL_BILLING;
      break;
    case "domain":
      binding = c.env.RL_DOMAIN_SETUP;
      break;
    case "qr_upload":
      binding = c.env.RL_QR_UPLOAD;
      break;
    case "write":
      binding = writeRateLimitBinding(c.env, user.plan);
      key = `${key}:${writeRouteFamily(c.req.path)}`;
      break;
  }

  const allowed = await rateLimitAllows(binding, key, {
    group,
    method: c.req.method,
    plan: user.plan,
  });
  if (!allowed) return rateLimitedResponse(c, group);
  return next();
}

export async function clickAnalyticsAllowed(
  env: Env,
  orgId: string,
  method = "GET",
): Promise<boolean> {
  return rateLimitAllows(env.RL_CLICK_RECORDING, `click:org:${orgId}`, {
    group: "click",
    method,
    failClosed: true,
  });
}
