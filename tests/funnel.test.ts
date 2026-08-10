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

  test("drops an over-long parameter rather than truncating it", () => {
    // Truncation was the old rule and it was the wrong one: the first 200
    // characters of an email address are still an email address.
    browser({ search: `?utm_campaign=${"x".repeat(500)}` });
    expect(landingContext().utm_campaign).toBeUndefined();
  });

  test("drops a campaign value carrying an email address", () => {
    browser({ search: "?utm_campaign=alice@example.com&utm_source=newsletter" });
    const ctx = landingContext();
    expect(ctx.utm_campaign).toBeUndefined();
    // The clean parameter alongside it still comes through.
    expect(ctx.utm_source).toBe("newsletter");
  });

  test("drops values outside a plain campaign-name shape", () => {
    for (const bad of ["<script>", "a/b", "a?b", "a%20b", "a,b", ""]) {
      browser({ search: `?utm_campaign=${encodeURIComponent(bad)}` });
      expect(landingContext().utm_campaign).toBeUndefined();
    }
  });

  test("keeps the punctuation real campaign names use", () => {
    // "+" arrives as a space: that is what URLSearchParams does with a query
    // string, and spaces are allowed through deliberately because campaign
    // names have them.
    browser({ search: "?utm_campaign=spring-sale_2026.v2+eu" });
    expect(landingContext().utm_campaign).toBe("spring-sale_2026.v2 eu");
  });

  test("survives a malformed referrer instead of failing the pageview", () => {
    browser({ referrer: "not a url" });
    expect(landingContext()).toEqual({});
  });
});
