import { afterEach, describe, expect, test } from "bun:test";
import { FUNNEL, isFunnelEvent, landingContext } from "../src/app/lib/funnel";

/** Minimal stand-ins for the two globals landingContext() reads. */
function browser({ search = "", referrer = "", host = "rdyrct.com" } = {}) {
  (globalThis as { window?: unknown }).window = {
    location: { search, hostname: host },
  };
  (globalThis as { document?: unknown }).document = { referrer };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

describe("isFunnelEvent", () => {
  test("recognises every declared step, so none is dropped before consent", () => {
    for (const event of Object.values(FUNNEL)) expect(isFunnelEvent(event)).toBe(true);
  });

  test("ignores everything else, so the buffer only ever holds funnel steps", () => {
    expect(isFunnelEvent("qr_code_downloaded")).toBe(false);
    expect(isFunnelEvent("user_signed_in")).toBe(false);
    expect(isFunnelEvent("")).toBe(false);
  });
});

describe("landingContext", () => {
  test("reads the UTM parameters a campaign lands with", () => {
    browser({ search: "?utm_source=newsletter&utm_medium=email&utm_campaign=spring" });
    expect(landingContext()).toEqual({
      utm_source: "newsletter",
      utm_medium: "email",
      utm_campaign: "spring",
    });
  });

  test("keeps only the referrer's hostname, never its path or query", () => {
    browser({ referrer: "https://news.ycombinator.com/item?id=12345&secret=abc" });
    expect(landingContext()).toEqual({ referrer_host: "news.ycombinator.com" });
  });

  test("drops our own hostname, which is a navigation and not a referral", () => {
    browser({ referrer: "https://rdyrct.com/pricing", host: "rdyrct.com" });
    expect(landingContext()).toEqual({});
  });

  test("caps a long parameter rather than shipping an unbounded string", () => {
    browser({ search: `?utm_campaign=${"x".repeat(500)}` });
    expect(landingContext().utm_campaign).toHaveLength(200);
  });

  test("survives a malformed referrer instead of failing the pageview", () => {
    browser({ referrer: "not a url" });
    expect(landingContext()).toEqual({});
  });
});
