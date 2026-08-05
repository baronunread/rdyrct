/**
 * A consistent header baseline for every response this Worker sends
 * (API, redirects, errors, the SPA and its static assets): one missed
 * response path shouldn't leave weaker browser protections than the rest
 * (see issue #21). Not applied to the reverse-proxied blog (see index.ts) —
 * that's a separate Next.js app on Vercel with its own script/style needs,
 * and overriding its CSP here could break its hydration.
 *
 * `'unsafe-inline'` on style-src only: the app uses React inline `style`
 * props throughout, and CSP has no practical hash/nonce story for those.
 * Inline *script* has no such allowance — the one script this app used to
 * inline (the pre-paint theme bootstrap) now lives at /theme-init.js instead.
 *
 * connect-src/img-src include PostHog's ingest host: analytics-consent
 * capture calls (posthog-js) go straight to it, not through this Worker.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://*.posthog.com",
  "font-src 'self'",
  "connect-src 'self' https://*.posthog.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function applySecurityHeaders(res: Response): Response {
  res.headers.set("Content-Security-Policy", CSP);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  return res;
}

export function isBlogPath(pathname: string): boolean {
  return pathname === "/blog" || pathname.startsWith("/blog/");
}
