import { afterEach, describe, expect, test } from "bun:test";
import { installBrowserGlobals, removeBrowserGlobals } from "./browser-globals";
import {
  captureGoogleSignup,
  FUNNEL,
  googleSignupUrl,
  isFunnelEvent,
  landingContext,
  SIGNUP_FAILED,
  USER_SIGNED_UP,
} from "../src/app/lib/funnel";

/** Minimal stand-ins for the two globals landingContext() reads. */
function browser({ search = "", referrer = "", host = "rdyrct.com" } = {}) {
  installBrowserGlobals({
    window: { location: { search, hostname: host } },
    document: { referrer },
  });
}

afterEach(() => {
  removeBrowserGlobals("window", "document");
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

  // Not funnel-shaped itself, but fired from the same call site as
  // verificationCompleted right after OTP verification. Without this, a
  // visitor who hadn't yet answered the consent banner at that moment had
  // this event dropped while verificationCompleted survived, undercounting
  // signups relative to completed verifications.
  test("holds user_signed_up too, so it doesn't undercount against verificationCompleted", () => {
    expect(isFunnelEvent(USER_SIGNED_UP)).toBe(true);
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

// A Google signup never touches the form or the code screen, so before this
// it was missing from the funnel entirely: six Google starts in 60 days and
// no way to tell which ones made an account.
describe("Google signups", () => {
  function at(href: string) {
    const replaced: string[] = [];
    const location = { origin: "https://rdyrct.com", href };
    installBrowserGlobals({
      window: {
        location,
        history: { state: null, replaceState: (_s, _u, url) => replaced.push(url) },
      },
    });
    return replaced;
  }

  test("the new-user redirect carries the marker and keeps next's own query", () => {
    at("https://rdyrct.com/signup");
    expect(googleSignupUrl("/billing?plan=pro")).toBe("/billing?plan=pro&signup=google");
    expect(googleSignupUrl("/dashboard")).toBe("/dashboard?signup=google");
  });

  test("landing with the marker counts one signup and strips it", () => {
    const replaced = at("https://rdyrct.com/billing?plan=pro&signup=google");
    const events: string[] = [];
    captureGoogleSignup((event) => events.push(event));
    expect(events).toEqual([FUNNEL.signupSubmitted, USER_SIGNED_UP]);
    expect(replaced).toEqual(["/billing?plan=pro"]);
  });

  test("a returning Google sign-in, with no marker, counts nothing", () => {
    at("https://rdyrct.com/dashboard");
    const events: string[] = [];
    captureGoogleSignup((event) => events.push(event));
    expect(events).toEqual([]);
  });

  test("a failed signup is buffered like the steps", () => {
    expect(isFunnelEvent(SIGNUP_FAILED)).toBe(true);
  });
});
