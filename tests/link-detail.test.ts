import { describe, expect, test } from "bun:test";
import { linkDisplayTitle } from "../src/app/lib/link-display";

describe("linkDisplayTitle", () => {
  test("drops the scheme from a custom-domain link", () => {
    expect(linkDisplayTitle("https://brand.example/abc")).toBe("brand.example/abc");
  });

  test("drops the scheme from a shared-host link", () => {
    expect(linkDisplayTitle("https://rdyr.cc/abc")).toBe("rdyr.cc/abc");
  });

  // A deployment with no SHARED_LINK_HOST builds shared links from APP_URL,
  // which is plain http in local e2e runs.
  test("drops a plain http scheme too", () => {
    expect(linkDisplayTitle("http://localhost:5174/abc")).toBe("localhost:5174/abc");
  });
});
