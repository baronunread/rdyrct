import { describe, expect, test } from "bun:test";
import { blockHostOf, holdReasonFor } from "../src/shared/abuse-rules";

describe("holdReasonFor", () => {
  test("holds a brand name on a free host, the 2026-10-18 shape", () => {
    expect(holdReasonFor("https://phonepewheel-production.up.railway.app/")).toContain("phonepe");
    expect(holdReasonFor("https://flipkart-production-7ae5.up.railway.app/")).toContain("flipkart");
    expect(holdReasonFor("https://paypal-login.vercel.app/x")).toContain("vercel.app");
  });

  test("leaves a brand on its own site, and an ordinary app on a free host", () => {
    expect(holdReasonFor("https://www.paypal.com/signin")).toBeNull();
    expect(holdReasonFor("https://my-portfolio.vercel.app/")).toBeNull();
    expect(holdReasonFor("https://pub-8321dab5ce834f2.r2.dev/")).toBeNull();
  });

  test("does not match a free host name in the path or query", () => {
    expect(holdReasonFor("https://example.com/paypal.vercel.app")).toBeNull();
  });

  test("an unparseable destination is not held here (validation rejects it)", () => {
    expect(holdReasonFor("not a url")).toBeNull();
  });
});

describe("blockHostOf", () => {
  test("lowercases and drops www and the port", () => {
    expect(blockHostOf("https://WWW.Evil.Example:8443/x")).toBe("evil.example");
  });
  test("null for junk", () => {
    expect(blockHostOf("nope")).toBeNull();
  });
});
