import { describe, expect, test } from "bun:test";
import { currentNavKey } from "../src/app/components/marketing-nav";

describe("currentNavKey", () => {
  test("rests the tab on the page's own item", () => {
    expect(currentNavKey("/pricing")).toBe("pricing");
    expect(currentNavKey("/docs")).toBe("docs");
  });

  test("puts every page under Product on Product, its panel's and the comparisons", () => {
    for (const path of [
      "/qr-code-generator",
      "/utm-builder",
      "/branded-link-shortener",
      "/compare",
      "/roadmap",
      "/bitly-alternative",
      "/whatsapp-qr-code",
      "/vcard-qr-code",
      "/wifi-qr-code",
      "/qr-code-monkey-alternative",
      "/tinyurl-alternative",
    ]) {
      expect(currentNavKey(path)).toBe("product");
    }
  });

  test("rests nowhere on the home page or a page the nav does not name", () => {
    expect(currentNavKey("/")).toBeNull();
    expect(currentNavKey("/privacy")).toBeNull();
  });
});
