/**
 * One baseline for every response (#21). `'unsafe-inline'` on style-src only: React inline
 * `style` props have no hash story. PostHog needs script-src too (posthog-js injects its
 * assets script), or exception capture dies silently (tests/e2e/production/csp.pw.ts).
 */
import { POSTHOG_CONFIGURED, RDYRCT_SITE } from "../shared/site";
import type { Env } from "./env";
import { turnstileMode } from "./turnstile";

const POSTHOG = POSTHOG_CONFIGURED ? "https://*.posthog.com" : "";
const SENTRY =
  "https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://*.ingest.us.sentry.io";
const STATS = RDYRCT_SITE ? "https://stats.brnr.dev" : "";
/** The only remote images: each directory wants its own badge. rdyrct.com only. */
const FAZIER = RDYRCT_SITE ? "https://fazier.com" : "";
const PEERPUSH = RDYRCT_SITE ? "https://peerpush.com" : "";
const LAUNCHSTAG = RDYRCT_SITE ? "https://launchstag.com" : "";

const TURNSTILE = "https://challenges.cloudflare.com";

const directive = (...parts: string[]) => parts.filter(Boolean).join(" ");

/**
 * The theme bootstrap in index.html, allowed by its own sha256. It covers the
 * exact bytes between the tags: a formatter reindenting that block breaks it,
 * silently and only in production. tests/theme-init.test.ts recomputes it.
 */
const THEME_INIT_HASH = "'sha256-WT7DRSIUPW1UJ8Sl+CccEgo69mkW5WedEO/xrvrD5hQ='";

// The React Refresh preamble is inline and script-src 'self' refuses it.
// `import.meta.env.DEV` is a build-time constant, so a deployed Worker cannot
// ship 'unsafe-inline'.
function buildCsp(turnstile: string): string {
  const scriptSrc = import.meta.env.DEV
    ? directive("script-src 'self' 'unsafe-inline'", POSTHOG, STATS, turnstile)
    : directive("script-src 'self'", THEME_INIT_HASH, POSTHOG, STATS, turnstile);
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    directive("img-src 'self' data:", POSTHOG, FAZIER, PEERPUSH, LAUNCHSTAG),
    "font-src 'self'",
    directive("connect-src 'self'", POSTHOG, SENTRY, STATS),
    ...(turnstile ? [directive("frame-src", turnstile)] : []),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const CSP = buildCsp("");
const CSP_WITH_TURNSTILE = buildCsp(TURNSTILE);

/**
 * Returns a copy: ASSETS responses and Response.redirect() have immutable
 * headers, and writing to them throws. `turnstile`: pass turnstileAllowed().
 */
export function applySecurityHeaders(res: Response, turnstile = false): Response {
  const out = new Response(res.body, res);
  out.headers.set("Content-Security-Policy", turnstile ? CSP_WITH_TURNSTILE : CSP);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  out.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  // frame-ancestors 'none' covers browsers that read CSP; this is for older ones.
  out.headers.set("X-Frame-Options", "DENY");
  out.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return out;
}

/** Link hosts serve redirects and the disabled page, which never load Turnstile. */
export function turnstileAllowed(env: Env, url: string): boolean {
  return turnstileMode(env) === "on" && new URL(url).host === env.APP_HOST.toLowerCase();
}
