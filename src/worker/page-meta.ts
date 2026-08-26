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

/** The q of one already-lowered, already-trimmed Accept segment: the
 * parameter's value, the default 1 without one, or null when the segment
 * carries a q nobody can read or trust (outside [0,1]). */
function segmentQuality(parameters: string[]): number | null {
  const parameter = parameters.find((piece) => piece.startsWith("q="));
  if (parameter === undefined) return 1;
  const value = Number(parameter.slice(2));
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** The quality `wanted` carries in an Accept header: its own best q when the
 * header names it exactly, otherwise the best q of a wildcard covering it,
 * else 0. A named type keeps its own q even at zero, where a wildcard would
 * otherwise admit it back (RFC 9110 section 12.5.1). */
function acceptedQuality(accept: string | null | undefined, wanted: string): number {
  const family = `${wanted.split("/", 1)[0]}/*`;
  let named: number | null = null;
  let wildcard = 0;
  for (const part of accept?.toLowerCase().split(",") ?? []) {
    const pieces = part.split(";").map((piece) => piece.trim());
    const quality = segmentQuality(pieces.slice(1));
    if (quality === null) continue;
    if (pieces[0] === wanted) named = Math.max(named ?? 0, quality);
    else if (pieces[0] === "*/*" || pieces[0] === family) wildcard = Math.max(wildcard, quality);
  }
  return named ?? wildcard;
}

/** `text/markdown` must be explicitly preferable to HTML. A browser's broad
 * Accept header is not an instruction to replace the page with a document:
 * through a wildcard it still ranks HTML, so only a header that scores
 * Markdown strictly above it gets the document. Both scores start at 0, so
 * an unmentioned Markdown stays HTML too. */
function markdownPreferred(accept: string | null | undefined): boolean {
  return acceptedQuality(accept, "text/markdown") > acceptedQuality(accept, "text/html");
}

function withAcceptVary(response: Response): Response {
  const varied = new Response(response.body, response);
  const vary = varied.headers.get("Vary");
  if (!vary?.split(",").some((value) => value.trim().toLowerCase() === "accept")) {
    varied.headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
  }
  return varied;
}

/** What /pricing.md carried in _headers before negotiation moved it into the
 * Worker. Unhashed, hand-written copy: an hour of cache costs nothing. */
const MARKDOWN_CACHE = "public, max-age=3600, must-revalidate";

/** A page representation for agents, only when its source explicitly exists. */
export function markdownPage(url: URL, accept: string | null | undefined): Response | null {
  const meta = lookup(PUBLIC_PAGE_META, url.pathname);
  if (!meta?.markdown || !markdownPreferred(accept)) return null;
  const canonical = canonicalFor(url, url.pathname);
  // JSON quoting keeps YAML valid whatever the copy says: descriptions read
  // like prose, and prose is full of colons.
  const body = `---\ntitle: ${JSON.stringify(meta.title)}\ndescription: ${JSON.stringify(meta.description)}\ncanonical: ${canonical}\n---\n\n${meta.markdown}\n`;
  return withAcceptVary(
    new Response(body, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": MARKDOWN_CACHE,
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
