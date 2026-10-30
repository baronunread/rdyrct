/**
 * What a held or warned link answers with instead of a redirect (#344).
 *
 * Both pages are prerendered into the build next to the 404
 * (scripts/prerender-404.tsx), so they carry the app's stylesheet and theme
 * and no script. Without the build (dev, the worker tests) the Worker serves
 * a plain page with the same words and the same slots instead, so the
 * behaviour is the same everywhere and only the styling differs.
 *
 * Neither page says why. See src/shared/link-pages.ts.
 */
import {
  DISABLED_PAGE,
  HELD_PAGE,
  WARN_CONTINUE_SLOT,
  WARN_HOST_SLOT,
  WARN_PAGE,
} from "../shared/link-pages";
import { escapeHtml, safeUrl } from "./email-html";
import { madeWith, PAGE_HEADERS, prerenderedPage } from "./not-found-page";

const plainPage = (name: string, title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body data-page="${name}"><div id="root">${body}</div></body></html>`;

const PLAIN_HELD = plainPage(
  "link-held",
  HELD_PAGE.title,
  `<h1>${escapeHtml(HELD_PAGE.heading)}</h1><p>${escapeHtml(HELD_PAGE.body)}</p>`,
);

const PLAIN_DISABLED = plainPage(
  "link-disabled",
  DISABLED_PAGE.title,
  `<h1>${escapeHtml(DISABLED_PAGE.heading)}</h1><p>${escapeHtml(DISABLED_PAGE.body)}</p>`,
);

const PLAIN_WARN = plainPage(
  "link-warn",
  WARN_PAGE.title,
  `<h1>${escapeHtml(WARN_PAGE.heading)}</h1><p>${escapeHtml(WARN_PAGE.lead)}</p>` +
    `<p data-slot="${WARN_HOST_SLOT}">example.com</p><p>${escapeHtml(WARN_PAGE.advice)}</p>` +
    `<p><a data-slot="${WARN_CONTINUE_SLOT}" href="/" rel="noreferrer">${escapeHtml(WARN_PAGE.action)}</a></p>`,
);

const HEADERS = {
  ...PAGE_HEADERS,
  // A held or warned link is somebody's link, not a page of ours.
  "x-robots-tag": "noindex",
};

/**
 * The "under review" page for a held link. A 403, not a 404: the link exists
 * and may come back, and a 404 told its owner nothing.
 */
export async function heldPage(assets: Fetcher, requestUrl: string): Promise<Response> {
  const html = (await prerenderedPage(assets, requestUrl, "link-held")) ?? PLAIN_HELD;
  return new Response(html, { status: 403, headers: HEADERS });
}

/**
 * The page for a banned owner's link or custom domain. A 410: the link is
 * gone for good unless an admin reverses the ban, and the org it belongs to
 * is deleted 90 days on. `home` is rdyrct's URL on our own hosts and null
 * on a customer's domain, for the "Made with rdyrct" link.
 */
export async function disabledPage(
  assets: Fetcher,
  requestUrl: string,
  home: string | null,
): Promise<Response> {
  const html = (await prerenderedPage(assets, requestUrl, "link-disabled")) ?? PLAIN_DISABLED;
  return madeWith(new HTMLRewriter(), home, "disabled").transform(
    new Response(html, { status: 410, headers: HEADERS }),
  );
}

/**
 * The warning before a redirect: the destination's host, written in as text
 * (HTMLRewriter escapes it), and a Continue link to the destination itself.
 * The visitor reads where they are going before they go, which is what costs
 * a scam its clicks while a real link loses one click of friction.
 */
export async function warnPage(
  assets: Fetcher,
  requestUrl: string,
  destination: string,
): Promise<Response> {
  const html = (await prerenderedPage(assets, requestUrl, "link-warn")) ?? PLAIN_WARN;
  const host = hostOf(destination);
  const page = new HTMLRewriter()
    .on(`[data-slot="${WARN_HOST_SLOT}"]`, {
      element: (e) => void e.setInnerContent(host),
    })
    .on(`[data-slot="${WARN_CONTINUE_SLOT}"]`, {
      // Only ever http(s): a scheme check, not an escape, is what keeps a
      // javascript: URL from becoming a button.
      element: (e) => void e.setAttribute("href", safeUrl(destination)),
    });
  return page.transform(new Response(html, { status: 200, headers: HEADERS }));
}

/** The host a visitor should recognise. A destination is always a URL we
 * parsed at create time, so the fallback is for a value that predates that. */
function hostOf(destination: string): string {
  try {
    return new URL(destination).host;
  } catch {
    return destination;
  }
}
