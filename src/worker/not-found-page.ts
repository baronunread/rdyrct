/**
 * Rendered into index.html at build time by scripts/prerender-404.tsx. Without
 * the prerendered file (dev, worker tests) the asset store answers with the app
 * shell, which is replaced with a plain 404.
 */

import { MADE_WITH_SLOT } from "../shared/link-pages";
import { RDYRCT_SITE } from "../shared/site";

export const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  // A miss today can be a link tomorrow: never let a cache keep it.
  "cache-control": "no-store",
};

/** The `data-page` marker tells it from the app shell. */
export async function prerenderedPage(
  assets: Fetcher,
  requestUrl: string,
  name: string,
): Promise<string | null> {
  const page = await assets.fetch(new Request(new URL(`/${name}`, requestUrl)));
  const html = page.ok ? await page.text() : "";
  return html.includes(`data-page="${name}"`) ? html : null;
}

/** Only on our own hosts: a customer's miss is not our billboard, and a fork must not advertise us. */
export function madeWith(rewriter: HTMLRewriter, home: string | null, page: string) {
  return rewriter.on(`[data-slot="${MADE_WITH_SLOT}"]`, {
    element(element) {
      if (!RDYRCT_SITE || !home) {
        element.remove();
        return;
      }
      const url = new URL("/", home);
      url.search = new URLSearchParams({
        utm_source: "short-link",
        utm_medium: "referral",
        utm_campaign: "made-with",
        utm_content: page,
      }).toString();
      element.setAttribute("href", url.toString());
    },
  });
}

export async function notFoundPage(
  assets: Fetcher,
  requestUrl: string,
  home: string | null,
): Promise<Response> {
  const html = await prerenderedPage(assets, requestUrl, "404-short");
  if (!html) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const link = new HTMLRewriter().on(`#root a:not([data-slot])`, {
    element(element) {
      if (home) element.setAttribute("href", home);
      else element.remove();
    },
  });
  return madeWith(link, home, "404").transform(
    new Response(html, { status: 404, headers: PAGE_HEADERS }),
  );
}
