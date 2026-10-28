/**
 * A consistent header baseline for every response this Worker sends
 * (API, redirects, errors, the SPA and its static assets): one missed
 * response path shouldn't leave weaker browser protections than the rest
 * (see issue #21). The blog is a separate Worker (rdyrct-blog) with its own
 * Workers Route on rdyrct.com/blog*, so it never reaches this file at all.
 *
 * `'unsafe-inline'` on style-src only: the app uses React inline `style`
 * props throughout, and CSP has no practical hash/nonce story for those.
 * Inline *script* has no such allowance — the one script this app used to
 * inline (the pre-paint theme bootstrap) is allowed by its own hash instead,
 * see THEME_INIT_HASH below.
 *
 * PostHog appears in script-src, connect-src and img-src. All three are
 * needed: posthog-js does not bundle its optional features, it builds
 * `<assets host>/static/<name>.js` and injects it with createElement("script")
 * the first time one is used, and lib/posthog.ts enables `capture_exceptions`.
 * Allowing the ingest calls but not the script left exception capture dead in
 * production while every test stayed green, because the dev server never
 * loads PostHog. Covered now by tests/e2e/production/csp.pw.ts.
 *
 * The stats script loads from stats.brnr.dev and sends its page views back to
 * the same host, so it needs both script-src and connect-src too.
 *
 * Neither is allowed where it cannot load: the stats script is rdyrct.com's
 * own (RDYRCT_SITE), and PostHog needs a project token in the build. A
 * self-hosted copy allows no third-party script at all.
 *
 * Cloudflare Turnstile (#304) is the one source decided per request rather
 * than per build: its script and the iframe its challenge runs in come from
 * challenges.cloudflare.com, allowed only on the app's own host (APP_HOST)
 * and only when Turnstile is on (both keys set), which is the only time the
 * browser loads it. See turnstileAllowed(). A custom domain, the shared link
 * host and a self-hosted copy without the keys never allow it.
 */
import { POSTHOG_CONFIGURED, RDYRCT_SITE } from "../shared/site";
import type { Env } from "./env";
import { turnstileMode } from "./turnstile";

const POSTHOG = POSTHOG_CONFIGURED ? "https://*.posthog.com" : "";
const SENTRY =
  "https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://*.ingest.us.sentry.io";
const STATS = RDYRCT_SITE ? "https://stats.brnr.dev" : "";
/** Fazier's and PeerPush's badges in the landing footer, the only remote
 *  images: each directory wants its own badge, not a copy. rdyrct.com only. */
const FAZIER = RDYRCT_SITE ? "https://fazier.com" : "";
const PEERPUSH = RDYRCT_SITE ? "https://peerpush.com" : "";

/** Turnstile's script and challenge iframe (#304). */
const TURNSTILE = "https://challenges.cloudflare.com";

/** A directive from its sources, with the ones switched off left out. */
const directive = (...parts: string[]) => parts.filter(Boolean).join(" ");

/**
 * The theme bootstrap in index.html, allowed by its own sha256 rather than
 * by opening script-src to every inline script on the page.
 *
 * It has to be inline: it runs before the first paint, so a file would put a
 * round trip in front of every page load, and defer or async would defeat
 * the point. A hash beats a nonce here because the document is a static
 * file, not a per-request render, so there is nothing to vary.
 *
 * The string covers the exact bytes between the tags, whitespace included. A
 * formatter reindenting that block is enough to break it, and the failure is
 * silent and production-only: the browser refuses the script and the page
 * paints in the wrong theme first. tests/theme-init.test.ts recomputes it
 * from index.html and fails when the two have drifted.
 *
 * Written by hand rather than computed by a build plugin. Plugins for this
 * exist (vite-plugin-csp-guard and friends), but they want to own the policy
 * and emit it as a meta tag or a headers file, and this app's CSP is set by
 * the Worker on every response, API and redirects included. Adopting one to
 * avoid retyping 44 characters would move the whole policy to fit the tool.
 */
const THEME_INIT_HASH = "'sha256-2nKA5EXyqoJ3UwqcLiwLWGCwtYg6xDyL/FbNRuFw1c0='";

// `@vitejs/plugin-react` injects an inline module preamble (the React Refresh
// runtime) into index.html when Vite serves the app in dev. `script-src
// 'self'` refuses it, the runtime never installs, and the SPA renders
// nothing at all — which is how the e2e smoke test found this.
//
// A built bundle has no preamble, so the allowance is compiled out rather
// than switched at runtime: `import.meta.env.DEV` is a build-time constant,
// so a deployed Worker cannot ship 'unsafe-inline' through a misread var.
// The tradeoff is that e2e exercises a marginally looser policy than
// production; everything except this one directive is identical.
function buildCsp(turnstile: string): string {
  const scriptSrc = import.meta.env.DEV
    ? directive("script-src 'self' 'unsafe-inline'", POSTHOG, STATS, turnstile)
    : directive("script-src 'self'", THEME_INIT_HASH, POSTHOG, STATS, turnstile);
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    directive("img-src 'self' data:", POSTHOG, FAZIER, PEERPUSH),
    "font-src 'self'",
    directive("connect-src 'self'", POSTHOG, SENTRY, STATS),
    // Only Turnstile's challenge iframe. With no frame-src at all the
    // browser falls back to default-src 'self', which is the same rule.
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
 * Returns a copy carrying the baseline, rather than setting headers on the
 * response passed in. Not every response has mutable headers: anything from
 * the ASSETS binding (every static file and the SPA fallback) and anything
 * built by Response.redirect() carries an immutable Headers guard, and
 * writing to one throws "Can't modify immutable headers". Mutating in place
 * therefore broke every static asset request, not just an exotic edge case.
 *
 * The copy is cheap: the body is handed over by reference, never read.
 *
 * `turnstile` adds challenges.cloudflare.com: pass turnstileAllowed().
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
  // frame-ancestors 'none' in the CSP above already blocks framing in every
  // browser that reads CSP; X-Frame-Options is the same rule for the ones
  // that only ever learned the older header.
  out.headers.set("X-Frame-Options", "DENY");
  out.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return out;
}

/**
 * Whether this response may allow Turnstile in its CSP: the check is on, and
 * the request is for the app itself. Link hosts (custom domains, the shared
 * link host) serve redirects and the disabled page, which never load it.
 */
export function turnstileAllowed(env: Env, url: string): boolean {
  return turnstileMode(env) === "on" && new URL(url).host === env.APP_HOST.toLowerCase();
}
