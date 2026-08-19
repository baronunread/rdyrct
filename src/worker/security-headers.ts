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
 * inline (the pre-paint theme bootstrap) now lives at /theme-init.js instead.
 *
 * PostHog appears in script-src, connect-src and img-src. All three are
 * needed: posthog-js does not bundle its optional features, it builds
 * `<assets host>/static/<name>.js` and injects it with createElement("script")
 * the first time one is used, and lib/posthog.ts enables `capture_exceptions`.
 * Allowing the ingest calls but not the script left exception capture dead in
 * production while every test stayed green, because the dev server never
 * loads PostHog. Covered now by tests/e2e/production/csp.pw.ts.
 */
const POSTHOG = "https://*.posthog.com";

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
// 'wasm-unsafe-eval' is for Cap's solver (#98). WebAssembly.compile() counts
// as script evaluation, so `script-src 'self'` refuses it outright and the
// widget falls back to a pure-JS solver. This directive exists precisely to
// allow WASM without allowing eval() or inline script: it buys back the fast
// path on the phones that need it most, and grants nothing else. The module
// itself is a same-origin Vite asset, never a CDN.
const SCRIPT_SRC = import.meta.env.DEV
  ? `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${POSTHOG}`
  : `script-src 'self' 'wasm-unsafe-eval' ${POSTHOG}`;

const CSP = [
  "default-src 'self'",
  SCRIPT_SRC,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${POSTHOG}`,
  "font-src 'self'",
  // Cap (#98) solves its proof-of-work in a Web Worker built from a Blob
  // URL, and with no worker-src the browser falls through child-src to
  // default-src 'self', which refuses blob:. Everything else about Cap is
  // same-origin: the widget is bundled from npm and its WASM ships as a
  // Vite asset, so nothing here opens a door to a third party. The cost is
  // that a script which already ran could spawn a worker from a string it
  // built, which script-src 'self' still gates on getting there first.
  "worker-src 'self' blob:",
  `connect-src 'self' ${POSTHOG}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Returns a copy carrying the baseline, rather than setting headers on the
 * response passed in. Not every response has mutable headers: anything from
 * the ASSETS binding (every static file and the SPA fallback) and anything
 * built by Response.redirect() carries an immutable Headers guard, and
 * writing to one throws "Can't modify immutable headers". Mutating in place
 * therefore broke every static asset request, not just an exotic edge case.
 *
 * The copy is cheap: the body is handed over by reference, never read.
 */
export function applySecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set("Content-Security-Policy", CSP);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  out.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  return out;
}
