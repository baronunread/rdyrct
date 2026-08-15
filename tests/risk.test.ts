import { afterEach, describe, expect, test } from "bun:test";
import type { JsonValue } from "../src/shared/types";
import { RISK_PROVIDER_DNS, scoreDestination } from "../src/worker/risk";

/**
 * Reading the resolver's answers (#68).
 *
 * The distinction every test here turns on is unscored (null) versus clean
 * (score 0). They are not the same thing, and conflating them is the way
 * this feature fails quietly: a provider outage would mark the whole table
 * clean and nobody would notice, because a clean table is what you expect to
 * see. So a shape we do not recognise stays null and gets looked at again.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers every lookup with one canned DNS-over-HTTPS body. */
function resolverReturns(body: JsonValue, ok = true) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status: ok ? 200 : 502 });
}

describe("reading the resolver", () => {
  test("scores a domain the resolver refuses to resolve", async () => {
    // 0.0.0.0 is how Cloudflare's security resolver says "not this one".
    resolverReturns({ Status: 0, Answer: [{ data: "0.0.0.0" }] });
    expect(await scoreDestination("https://malware.example/page")).toEqual({
      score: 100,
      reasons: ["dns_blocklist"],
      provider: RISK_PROVIDER_DNS,
    });
  });

  test("scores an ordinary answer clean", async () => {
    resolverReturns({ Status: 0, Answer: [{ data: "140.82.121.3" }] });
    expect(await scoreDestination("https://github.com/x")).toEqual({
      score: 0,
      reasons: [],
      provider: RISK_PROVIDER_DNS,
    });
  });

  test("treats a name that does not exist as clean, not dangerous", async () => {
    // NXDOMAIN. A dead link is a dead link; scoring every typo as malware
    // would bury the real findings.
    resolverReturns({ Status: 3 });
    expect((await scoreDestination("https://nothing.invalid"))?.score).toBe(0);
  });
});

describe("staying unscored rather than guessing", () => {
  test("leaves a failed lookup unscored", async () => {
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    expect(await scoreDestination("https://example.com")).toBeNull();
  });

  test("leaves a non-200 unscored", async () => {
    resolverReturns({ Status: 0, Answer: [] }, false);
    expect(await scoreDestination("https://example.com")).toBeNull();
  });

  test("leaves an unrecognised answer shape unscored", async () => {
    // The resolver is a public service, not a documented threat feed. If it
    // ever answers something new, that must read as "we do not know", never
    // as "clean".
    resolverReturns({ something: "else" });
    expect(await scoreDestination("https://example.com")).toBeNull();
  });

  test("leaves a SERVFAIL unscored", async () => {
    resolverReturns({ Status: 2 });
    expect(await scoreDestination("https://example.com")).toBeNull();
  });
});

describe("destinations it will not look up", () => {
  test("skips anything that is not a URL", async () => {
    expect(await scoreDestination("not a url")).toBeNull();
  });

  test("skips a non-http scheme", async () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "ftp://files.example"]) {
      expect(await scoreDestination(url)).toBeNull();
    }
  });
});
