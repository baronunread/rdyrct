/**
 * The 404 a short-link host answers with: rdyr.cc and customers' custom
 * domains, which are redirect-only and never boot the app.
 *
 * It is the app's own 404 (NotFoundView), rendered into the built
 * index.html at build time by scripts/prerender-404.tsx, so it carries the
 * app's stylesheet, font and theme script. Here it only gets its link: back
 * to rdyrct on rdyr.cc, none on a customer's own domain, where a pointer to
 * rdyrct would be our brand on their miss.
 *
 * Without the prerendered file (dev, the worker tests) the asset store
 * answers with the app shell instead; that is caught and replaced with a
 * plain 404 rather than booting the app on a redirect-only host.
 */

export const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  // A miss today can be a link tomorrow: never let a cache keep it.
  "cache-control": "no-store",
};

/**
 * One of the pages scripts/prerender-404.tsx bakes into the build, or null
 * when the build has none (dev, the worker tests), where the asset store
 * answers every path with the app shell. The `data-page` marker is how the
 * two are told apart.
 */
export async function prerenderedPage(
  assets: Fetcher,
  requestUrl: string,
  name: string,
): Promise<string | null> {
  const page = await assets.fetch(new Request(new URL(`/${name}`, requestUrl)));
  const html = page.ok ? await page.text() : "";
  return html.includes(`data-page="${name}"`) ? html : null;
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
  const link = new HTMLRewriter().on("#root a", {
    element(element) {
      if (home) element.setAttribute("href", home);
      else element.remove();
    },
  });
  return link.transform(new Response(html, { status: 404, headers: PAGE_HEADERS }));
}
