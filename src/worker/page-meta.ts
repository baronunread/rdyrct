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
import { PUBLIC_PAGE_META } from "@/shared/page-meta";
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
 * What machine-readable description this page has, pointed at from the
 * response itself (RFC 8288) rather than left for an agent to guess at.
 *
 * `describedby` and `/llms.txt` only: that file exists and says what the site
 * is. `api-catalog` and `service-desc` belong here too, and go in when the
 * documents they name exist (#133, #136). A Link header that points at a 404
 * is worse than no header.
 */
const LINK_HEADER = '</llms.txt>; rel="describedby"; type="text/plain"';

function canonicalForHeader(url: URL): string {
  return `<${canonicalFor(url, url.pathname)}>; rel="canonical"`;
}

/** `text/markdown` must be explicitly preferable to HTML. A browser's broad
 * Accept header is not an instruction to replace the page with a document. */
function markdownPreferred(accept: string | null | undefined): boolean {
  if (!accept) return false;
  let markdown = -1;
  let html = -1;
  for (const part of accept.toLowerCase().split(",")) {
    const [type, ...parameters] = part.trim().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const value = quality ? Number(quality.trim().slice(2)) : 1;
    if (!Number.isFinite(value) || value < 0 || value > 1) continue;
    if (type === "text/markdown") markdown = Math.max(markdown, value);
    if (type === "text/html") html = Math.max(html, value);
  }
  return markdown > 0 && markdown > html;
}

function withAcceptVary(response: Response): Response {
  const varied = new Response(response.body, response);
  const vary = varied.headers.get("Vary");
  if (!vary?.split(",").some((value) => value.trim().toLowerCase() === "accept")) {
    varied.headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
  }
  return varied;
}

/** A page representation for agents, only when its source explicitly exists. */
export function markdownPage(url: URL, accept: string | null | undefined): Response | null {
  const meta = lookup(PUBLIC_PAGE_META, url.pathname);
  if (!meta?.markdown || !markdownPreferred(accept)) return null;
  const canonical = canonicalFor(url, url.pathname);
  const body = `---\ntitle: ${meta.title}\ndescription: ${meta.description}\ncanonical: ${canonical}\n---\n\n${meta.markdown}\n`;
  return withAcceptVary(
    new Response(body, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        Link: `${LINK_HEADER}, ${canonicalForHeader(url)}`,
      },
    }),
  );
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
  const described = new Response(response.body, response);
  described.headers.set("Link", LINK_HEADER);
  const rewritten = new HTMLRewriter()
    .on("title", new Text(meta.title))
    .on('meta[name="description"]', new MetaContent(meta.description))
    .on('meta[property="og:title"]', new MetaContent(meta.title))
    .on('meta[property="og:description"]', new MetaContent(meta.description))
    .on('meta[property="og:url"]', new MetaContent(canonical))
    .on('meta[name="twitter:title"]', new MetaContent(meta.title))
    .on('meta[name="twitter:description"]', new MetaContent(meta.description))
    .on('link[rel="canonical"]', new Href(canonical))
    .transform(described);
  return meta.markdown ? withAcceptVary(rewritten) : rewritten;
}
