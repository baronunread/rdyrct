import { describe, expect, it } from "vitest";
import { markdownPage, withPageMeta } from "../../src/worker/page-meta";

/**
 * The head each public page goes out with (#96).
 *
 * The SPA is one index.html for every route, so without this the QR
 * generator claimed the landing page's title, description and canonical:
 * two pages competing for one search result, and a link preview describing
 * the wrong thing. Setting them in the browser on mount is not enough,
 * because the clients behind a link preview (Slack, WhatsApp, iMessage) read
 * the bytes and never run the JavaScript.
 *
 * The rewrite is asserted here rather than through a request, because the
 * worker test environment has no built asset bundle and so serves no HTML.
 * The whole path is covered against the real bundle in
 * tests/e2e/production/seo.pw.ts.
 */

const SHELL = `<!doctype html><html><head>
<title>rdyrct - branded short links for your team</title>
<meta name="description" content="Branded short links for your team." />
<link rel="canonical" href="https://rdyrct.com" />
<meta property="og:title" content="rdyrct" />
<meta property="og:description" content="Branded short links for your team." />
<meta property="og:url" content="https://rdyrct.com" />
<meta name="twitter:title" content="rdyrct" />
<meta name="twitter:description" content="Branded short links for your team." />
</head><body></body></html>`;

function shell(): Response {
  return new Response(SHELL, { headers: { "content-type": "text/html; charset=utf-8" } });
}

async function rewrite(path: string): Promise<string> {
  const url = new URL(`https://rdyrct.com${path}`);
  return withPageMeta(shell(), url).text();
}

describe("the head a public page ships", () => {
  it("gives the QR generator its own title, description and canonical", async () => {
    const html = await rewrite("/qr-code-generator");

    expect(html).toContain("<title>Free QR code generator with logo - PNG and SVG, no account");
    expect(html).toMatch(/name="description" content="Make a custom QR code for free/);
    expect(html).toContain('href="https://rdyrct.com/qr-code-generator"');
  });

  it("leads the landing page with what people search for", async () => {
    const html = await rewrite("/");

    // "URL shortener" and "QR code generator" are the searches; the brand is
    // not, and a title that opens with it spends the result's best words on a
    // name nobody is looking for yet.
    expect(html).toContain("URL shortener and QR code generator");
  });

  it("carries the same words into the share preview tags", async () => {
    const html = await rewrite("/qr-code-generator");

    for (const tag of ["og:title", "twitter:title"]) {
      expect(html).toMatch(new RegExp(`"${tag}" content="Free QR code generator`));
    }
    expect(html).toContain('"og:url" content="https://rdyrct.com/qr-code-generator"');
  });

  it("leaves the signed-in app on the default head", async () => {
    // Nothing behind the login wants search traffic, so it keeps whatever
    // index.html says rather than earning an entry in the table.
    const html = await rewrite("/dashboard");

    // Closing tag included: without it the assertion is a prefix, and a title
    // with something appended to it would pass.
    expect(html).toContain("<title>rdyrct - branded short links for your team</title>");
  });

  it("does not touch anything that is not HTML", async () => {
    const asset = new Response("body{}", { headers: { "content-type": "text/css" } });
    const out = withPageMeta(asset, new URL("https://rdyrct.com/"));

    expect(await out.text()).toBe("body{}");
  });
});

describe("the Markdown representation", () => {
  it("serves a canonical Markdown document only when it is preferred", async () => {
    const url = new URL("https://rdyrct.com/pricing");
    const markdown = markdownPage(url, "text/html;q=0.4, text/markdown;q=0.9");

    expect(markdown?.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(markdown?.headers.get("Vary")).toBe("Accept");
    expect(markdown?.headers.get("cache-control")).toBe("public, max-age=3600, must-revalidate");
    expect(markdown?.headers.get("Link")).toContain(
      '<https://rdyrct.com/pricing>; rel="canonical"',
    );
    expect(await markdown?.text()).toContain("# rdyrct pricing");
  });

  it("keeps HTML when it is at least as preferred as Markdown", () => {
    const url = new URL("https://rdyrct.com/pricing");

    expect(markdownPage(url, "text/markdown;q=0.8, text/html;q=0.8")).toBeNull();
    expect(markdownPage(url, "text/markdown;q=0, text/html")).toBeNull();
  });

  it("reads a bare text/markdown as its default q=1 and drops an unparseable q", () => {
    const url = new URL("https://rdyrct.com/pricing");

    expect(markdownPage(url, "text/markdown")).not.toBeNull();
    expect(markdownPage(url, "text/markdown;q=nonsense")).toBeNull();
  });

  it("ranks HTML above Markdown through a wildcard and trims around the semicolon", () => {
    const url = new URL("https://rdyrct.com/pricing");

    expect(markdownPage(url, "text/markdown;q=0.9, */*;q=1")).toBeNull();
    expect(markdownPage(url, "text/markdown ;q=0.9")).not.toBeNull();
  });

  it("quotes front matter so prose with colons stays valid YAML", async () => {
    const markdown = await markdownPage(
      new URL("https://rdyrct.com/pricing"),
      "text/markdown;q=1",
    )?.text();

    expect(markdown).toMatch(/^title: "/m);
    expect(markdown).toMatch(/^description: "/m);
  });

  it("varies the HTML response that has a Markdown alternative", () => {
    const response = withPageMeta(shell(), new URL("https://rdyrct.com/pricing"));

    expect(response.headers.get("Vary")).toBe("Accept");
  });
});
