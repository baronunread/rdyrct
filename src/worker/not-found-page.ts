/**
 * The 404 a short-link host answers with: rdyr.cc and customers' custom
 * domains, which are redirect-only and so never boot the app.
 *
 * It used to be the plain text "Not found", while rdyrct.com showed the
 * app's styled page for the same miss. This is that page, drawn without the
 * app: inline styles (the CSP allows them), the design tokens for both
 * themes, no script and no request of its own.
 *
 * On a custom domain it names nobody: the visitor followed the customer's
 * link, and a pointer to rdyrct there would be our brand on their miss.
 */

// The light and dark tokens from src/app/styles.css.
const STYLE = `
:root { color-scheme: light dark; --bg: #f7f4ef; --text: #2a2733; --muted: #544f61; --accent: #745ab8; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #17151f; --text: #eae7f2; --muted: #c6c2d3; --accent: #cdb9f5; }
}
* { margin: 0; }
body {
  min-height: 100dvh; display: grid; place-items: center; padding: 0 16px;
  background: var(--bg); color: var(--text); text-align: center;
  font: 16px/1.5 Figtree, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.code { font-size: 2.25rem; font-weight: 700; color: var(--accent); }
p { margin-top: 0.5rem; font-size: 0.875rem; color: var(--muted); }
a { display: inline-block; margin-top: 1rem; font-size: 0.875rem; color: var(--accent); }
`;

export function notFoundPage(home: string | null): Response {
  const link = home ? `<a href="${home}">Go to rdyrct</a>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Not found</title><style>${STYLE}</style></head><body><main><div class="code">404</div><p>This short link does not exist (or the page moved).</p>${link}</main></body></html>`;
  return new Response(html, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // A miss today can be a link tomorrow: never let a cache keep it.
      "cache-control": "no-store",
    },
  });
}
