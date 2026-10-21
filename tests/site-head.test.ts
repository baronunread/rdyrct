import { describe, expect, test } from "bun:test";
import { siteHead } from "../scripts/site-head";

const html = await Bun.file("index.html").text();
const head = (page: string) => page.slice(0, page.indexOf("</head>"));

describe("siteHead", () => {
  test("a self-hosted build keeps none of rdyrct.com's head tags", () => {
    const fork = head(siteHead(html, false));
    expect(fork).not.toContain("stats.brnr.dev");
    expect(fork).not.toContain('rel="canonical"');
    expect(fork).not.toContain("og:image");
    expect(fork).not.toContain("application/ld+json");
    expect(fork).not.toContain("rdyrct.com only");
  });

  test("it keeps what every build needs: title, icon, the theme script", () => {
    const fork = head(siteHead(html, false));
    expect(fork).toContain("<title>");
    expect(fork).toContain('rel="icon"');
    expect(fork).toContain("dataset.theme");
  });

  test("rdyrct.com's own build is left exactly as written", () => {
    expect(siteHead(html, true)).toBe(html);
  });
});
