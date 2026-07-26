import { describe, expect, test } from "bun:test";
import { linkDisplayTitle } from "../src/app/lib/link-display";

describe("linkDisplayTitle", () => {
  test("prefers the link's custom domain over the app host", () => {
    expect(linkDisplayTitle("rdyrct.com", "brand.example", "abc")).toBe("brand.example/abc");
  });

  // Regression: appHost is a bare host (e.g. "rdyrct.com"), the same shape
  // domains.tsx shows for CNAME targets, never a full URL. Passing it to
  // `new URL()` threw "Invalid URL" and crashed the whole page for every
  // shared-domain link.
  test("falls back to the bare app host when there's no custom domain", () => {
    expect(linkDisplayTitle("rdyrct.com", null, "abc")).toBe("rdyrct.com/abc");
  });

  test("falls back to just the slug when neither is known yet", () => {
    expect(linkDisplayTitle(undefined, null, "abc")).toBe("/abc");
  });
});
