// Prerendered next to the 404 (scripts/prerender-404.tsx). Without the build (dev, worker tests) the Worker serves a plain page
// with the same words and slots. Neither page says why (src/shared/link-pages.ts).
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
  "x-robots-tag": "noindex",
};

// A 403, not a 404: the link exists and may come back.
export async function heldPage(assets: Fetcher, requestUrl: string): Promise<Response> {
  const html = (await prerenderedPage(assets, requestUrl, "link-held")) ?? PLAIN_HELD;
  return new Response(html, { status: 403, headers: HEADERS });
}

// A 410: gone unless an admin reverses the ban. home is null on a customer domain, for the Made with rdyrct link.
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

// The visitor reads where they are going: that costs a scam its clicks, while a real link loses one click of friction.
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
      // Only http(s): a scheme check, not an escape, keeps a javascript: URL from becoming a button.
      element: (e) => void e.setAttribute("href", safeUrl(destination)),
    });
  return page.transform(new Response(html, { status: 200, headers: HEADERS }));
}

// The fallback is for a value that predates parsing at create time.
function hostOf(destination: string): string {
  try {
    return new URL(destination).host;
  } catch {
    return destination;
  }
}
