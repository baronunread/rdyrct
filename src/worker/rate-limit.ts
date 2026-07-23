import type { Context, Next } from "hono";
import type { AppEnv, Env, SessionUser } from "./env";

const RATE_LIMIT_WINDOW_SECONDS = 60;

export type RateLimitGroup =
  | "auth"
  | "email"
  | "write"
  | "qr_upload"
  | "domain"
  | "checkout"
  | "click";

const EMAIL_AUTH_PATHS = new Set([
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
  const payload: Record<string, unknown> = {
    event,
    group,
    method: details.method,
  };
  if (details.plan) payload.plan = details.plan;
  if (details.error)
    payload.error = details.error instanceof Error ? details.error.name : "unknown";
  console.warn(JSON.stringify(payload));
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

/** Builds an ephemeral public-client key without exposing an IP address to
 * application storage or logs. The HMAC output exists only in Cloudflare's
 * rate-limit counter. */
export async function publicClientKey(request: Request, secret: string): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("cf-connecting-ip") ?? forwarded ?? "unknown";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(address)));
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
  const binding = group === "email" ? c.env.RL_EMAIL : c.env.RL_AUTH_PUBLIC;
  const allowed = await rateLimitAllows(binding, `${group}:${c.req.path}:${client}`, {
    group,
    method: c.req.method,
  });
  return allowed ? null : rateLimitedResponse(c, group);
}

export function signedApiGroup(
  path: string,
  method: string,
): Exclude<RateLimitGroup, "auth" | "email" | "click"> | null {
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
