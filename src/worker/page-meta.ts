/**
 * Per-page title, description and canonical, written into the HTML before it
 * leaves the Worker.
 *
 * The SPA ships one index.html for every route, so the QR generator went out
 * under the landing page's title, the landing page's description and the
 * landing page's canonical: two pages competing for one search result, and
 * a link preview that described the wrong thing.
 *
 * Doing it here rather than in the browser is the point. A crawler that
 * renders JavaScript would eventually see a title set on mount, but the ones
 * that matter for a link preview (Slack, WhatsApp, iMessage, Discord) read
 * the bytes and never run a line of it, and Bing's renderer is a queue with
 * no promised turnaround. HTMLRewriter costs one pass over a document this
 * Worker is already serving.
 *
 * Only the public routes are listed. Everything behind the login can keep the
 * default: it wants no traffic from a search engine.
 */
import { PUBLIC_PAGE_META, type PageMeta } from "@/shared/page-meta";
import { lookup } from "../shared/lookup";

/** The absolute URL a page should call canonical, on whichever host is
 * serving it. */
function canonicalFor(url: URL, path: string): string {
  return new URL(path, url.origin).toString();
}

class MetaContent {
  constructor(private readonly value: string) {}
  element(element: Element) {
    element.setAttribute("content", this.value);
  }
}

class Href {
  constructor(private readonly value: string) {}
  element(element: Element) {
    element.setAttribute("href", this.value);
  }
}

class Text {
  constructor(private readonly value: string) {}
  element(element: Element) {
    element.setInnerContent(this.value);
  }
}

/**
 * Rewrites the head of an HTML response for `path`, or returns it untouched
 * when the path is not a page we describe.
 *
 * The response is passed through unread when nothing matches, so the asset
 * path stays a straight pipe for everything else.
 */
export function withPageMeta(response: Response, url: URL): Response {
  const meta = lookup(PUBLIC_PAGE_META, url.pathname);
  if (!meta) return response;
  if (!response.headers.get("content-type")?.includes("text/html")) return response;

  const canonical = canonicalFor(url, url.pathname);
  return new HTMLRewriter()
    .on("title", new Text(meta.title))
    .on('meta[name="description"]', new MetaContent(meta.description))
    .on('meta[property="og:title"]', new MetaContent(meta.title))
    .on('meta[property="og:description"]', new MetaContent(meta.description))
    .on('meta[property="og:url"]', new MetaContent(canonical))
    .on('meta[name="twitter:title"]', new MetaContent(meta.title))
    .on('meta[name="twitter:description"]', new MetaContent(meta.description))
    .on('link[rel="canonical"]', new Href(canonical))
    .transform(response);
}
