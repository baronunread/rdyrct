// Written into the HTML before it leaves the Worker: link previews (Slack, WhatsApp, iMessage, Discord) read the bytes and never run JS,
// and Bing renderer has no promised turnaround. Only public routes are listed (#96).
import { PUBLIC_PAGE_META, type PageMeta } from "@/shared/page-meta";
import { lookup } from "../shared/lookup";
import { RDYRCT_SITE } from "../shared/site";
import { marked } from "marked";

function pageMeta(url: URL): PageMeta | undefined {
  return RDYRCT_SITE ? lookup(PUBLIC_PAGE_META, url.pathname) : undefined;
}

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

class Html {
  constructor(
    private readonly value: string,
    private readonly path: string,
  ) {}
  element(element: Element) {
    if (element.getAttribute("data-prerendered") === this.path) return;
    element.setInnerContent(this.value, { html: true });
  }
}

class EmptyRoot {
  element(element: Element) {
    element.setInnerContent("");
  }
}

class McpUrl {
  constructor(private readonly endpoint: string) {}
  element(element: Element) {
    const format = element.getAttribute("data-mcp-url");
    const text =
      format === "setup"
        ? `URL: ${this.endpoint}\nHeader: Authorization: Bearer YOUR_API_KEY`
        : this.endpoint;
    element.setInnerContent(text);
  }
}

class Text {
  constructor(private readonly value: string) {}
  element(element: Element) {
    element.setInnerContent(this.value);
  }
}

// A Link header that points at a 404 is worse than none: api-catalog and service-desc go in when their documents exist (#133, #136).
const LINK_HEADER = '</llms.txt>; rel="describedby"; type="text/plain"';

function canonicalForHeader(url: URL): string {
  return `<${canonicalFor(url, url.pathname)}>; rel="canonical"`;
}

function segmentQuality(parameters: string[]): number | null {
  const parameter = parameters.find((piece) => piece.startsWith("q="));
  if (parameter === undefined) return 1;
  const value = Number(parameter.slice(2));
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

// A named type keeps its own q even at zero, where a wildcard would admit it back (RFC 9110 section 12.5.1).
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

// A browser broad Accept is not a request for a document: only a header scoring Markdown strictly above HTML gets it.
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

const MARKDOWN_CACHE = "public, max-age=3600, must-revalidate";

export function markdownPage(url: URL, accept: string | null | undefined): Response | null {
  const meta = pageMeta(url);
  if (!meta?.markdown || !markdownPreferred(accept)) return null;
  const canonical = canonicalFor(url, url.pathname);
  // JSON quoting keeps YAML valid: descriptions are prose, and prose is full of colons.
  const markdown = meta.markdown.replaceAll("{{MCP_URL}}", canonicalFor(url, "/api/mcp"));
  const body = `---\ntitle: ${JSON.stringify(meta.title)}\ndescription: ${JSON.stringify(meta.description)}\ncanonical: ${canonical}\n---\n\n${markdown}\n`;
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

const FALLBACK_NAV = `<nav aria-label="Footer"><a href="/">Home</a> <a href="/pricing">Pricing</a> <a href="/docs">API and MCP docs</a> <a href="/qr-code-generator">QR code generator</a> <a href="/wifi-qr-code">WiFi QR code generator</a> <a href="/vcard-qr-code">vCard QR code generator</a> <a href="/whatsapp-qr-code">WhatsApp QR code generator</a> <a href="/utm-builder">UTM builder</a> <a href="/branded-link-shortener">Custom URL shortener</a> <a href="/google-url-shortener">Google URL shortener (goo.gl)</a> <a href="/roadmap">Roadmap</a> <a href="/privacy">Privacy policy</a> <a href="/terms">Terms of service</a> <a href="/signup">Sign up</a></nav>`;

// Without this, /pricing served the homepage body to every crawler and AI fetcher. Clipped like the original,
// so screen readers still reach it until React replaces it.
// Converted once per isolate: the copy only changes with a deploy.
const crawlerBodies = new Map<string, string>();

function crawlerBody(meta: PageMeta, url: URL): string {
  const key = `${url.origin}${url.pathname}`;
  const cached = crawlerBodies.get(key);
  if (cached) return cached;
  // Our own copy, never user input, so marked pass-through of raw HTML is not a way in.
  const markdown = (meta.markdown ?? `# ${meta.title}\n\n${meta.description}`).replaceAll(
    "{{MCP_URL}}",
    canonicalFor(url, "/api/mcp"),
  );
  const content = marked.parse(markdown, { async: false });
  const body = `<div style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%)">${content}${FALLBACK_NAV}</div>`;
  crawlerBodies.set(key, body);
  return body;
}

// Passed through unread when nothing matches, so the asset path stays a straight pipe. A self-hosted copy carries
// siteName (SITE_NAME, else its host) instead of our tagline.
export function withPageMeta(
  response: Response,
  url: URL,
  siteName?: string,
  appShell = false,
): Response {
  const meta = pageMeta(url);
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  if (!RDYRCT_SITE) {
    const rewriter = new HTMLRewriter().on("title", new Text(siteName || url.hostname));
    if (url.pathname !== "/" && !appShell) rewriter.on("#root", new EmptyRoot());
    return rewriter.transform(response);
  }
  // The build bakes the landing page into index.html, the shell for every app route: left in, a signed-in reload paints the marketing page.
  // Pages that are not prerendered ship an empty root.
  if (!meta) {
    if (url.pathname === "/" || appShell) return response;
    return new HTMLRewriter().on("#root", new EmptyRoot()).transform(response);
  }

  const canonical = canonicalFor(url, url.pathname);
  const described = new Response(response.body, response);
  described.headers.set("Link", LINK_HEADER);
  const rewriter = new HTMLRewriter();
  // The homepage keeps index.html hand-written fallback, which says more than its Markdown.
  if (url.pathname !== "/") {
    rewriter.on("#root", new Html(crawlerBody(meta, url), url.pathname));
  }
  if (url.pathname === "/docs") {
    rewriter.on("code[data-mcp-url]", new McpUrl(canonicalFor(url, "/api/mcp")));
  }
  const rewritten = rewriter
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
