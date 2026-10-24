import { afterEach, describe, expect, test } from "bun:test";
import type { JsonValue } from "../src/shared/types";
import {
  isWebRiskHit,
  RISK_PROVIDER_DNS,
  RISK_PROVIDER_WEB_RISK,
  scoreDestination,
  webRiskOutcome,
  webRiskVerdict,
} from "../src/worker/risk";

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
      webRiskAnswered: false,
    });
  });

  test("scores an ordinary answer clean", async () => {
    resolverReturns({ Status: 0, Answer: [{ data: "140.82.121.3" }] });
    expect(await scoreDestination("https://github.com/x")).toEqual({
      score: 0,
      reasons: [],
      provider: RISK_PROVIDER_DNS,
      webRiskAnswered: false,
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

/**
 * Google Web Risk (#341), with Google's API stubbed. The Lookup API answers
 * `{}` for a URL on no list and `{ threat: { threatTypes } }` for one on a
 * list.
 */
describe("Google Web Risk", () => {
  const KEY = "test-web-risk-key";

  /** Web Risk answers `webRisk`; the DNS resolver answers clean, or fails. */
  function providers(webRisk: JsonValue | "fail", options: { dnsFails?: boolean } = {}) {
    const calls: { url: string; key: string | null }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://webrisk.googleapis.com/")) {
        calls.push({ url, key: new Headers(init?.headers).get("x-goog-api-key") });
        if (webRisk === "fail") throw new Error("timeout");
        return new Response(JSON.stringify(webRisk), { status: 200 });
      }
      if (options.dnsFails) throw new Error("resolver down");
      return new Response(JSON.stringify({ Status: 0, Answer: [{ data: "93.184.216.34" }] }));
    };
    return calls;
  }

  test("names the threat for a listed URL, and sends the key in a header only", async () => {
    const calls = providers({ threat: { threatTypes: ["SOCIAL_ENGINEERING"], expireTime: "x" } });
    const verdict = await webRiskVerdict("https://kit.example/login?x=1", KEY);
    expect(verdict).toEqual({
      score: 100,
      reasons: ["web_risk_social_engineering"],
      provider: RISK_PROVIDER_WEB_RISK,
    });
    expect(verdict && isWebRiskHit(verdict)).toBe(true);
    const [call] = calls;
    expect(call?.key).toBe(KEY);
    expect(call?.url).not.toContain(KEY);
    // The full URL is what is looked up, not just the host.
    expect(new URL(call?.url ?? "").searchParams.get("uri")).toBe("https://kit.example/login?x=1");
    expect(new URL(call?.url ?? "").searchParams.getAll("threatTypes")).toEqual([
      "MALWARE",
      "SOCIAL_ENGINEERING",
      "UNWANTED_SOFTWARE",
    ]);
  });

  test("reads an empty answer as clean", async () => {
    providers({});
    expect(await webRiskVerdict("https://example.com", KEY)).toEqual({
      score: 0,
      reasons: [],
      provider: RISK_PROVIDER_WEB_RISK,
    });
  });

  test("stays unscored on a timeout or an answer it does not recognise", async () => {
    providers("fail");
    expect(await webRiskVerdict("https://example.com", KEY)).toBeNull();
    providers({ threat: "not an object" });
    expect(await webRiskVerdict("https://example.com", KEY)).toBeNull();
  });

  test("runs alongside the DNS check when the key is set, and the worse answer wins", async () => {
    providers({ threat: { threatTypes: ["MALWARE"] } });
    expect(await scoreDestination("https://kit.example/", { WEB_RISK_API_KEY: KEY })).toEqual({
      score: 100,
      reasons: ["web_risk_malware"],
      provider: `${RISK_PROVIDER_DNS}+${RISK_PROVIDER_WEB_RISK}`,
      webRiskAnswered: true,
    });
  });

  test("is skipped without a key, so a fork with none never calls Google", async () => {
    const calls = providers({ threat: { threatTypes: ["MALWARE"] } });
    const verdict = await scoreDestination("https://kit.example/", {});
    expect(calls).toHaveLength(0);
    expect(verdict?.provider).toBe(RISK_PROVIDER_DNS);
    expect(verdict?.webRiskAnswered).toBe(false);
  });

  test("falls back to the DNS answer when Web Risk is down", async () => {
    providers("fail");
    const verdict = await scoreDestination("https://example.com", { WEB_RISK_API_KEY: KEY });
    expect(verdict?.provider).toBe(RISK_PROVIDER_DNS);
    expect(verdict?.webRiskAnswered).toBe(false);
  });

  test("tells a Google error apart from a DNS-only answer and a clean one", async () => {
    const env = { WEB_RISK_API_KEY: KEY };
    globalThis.fetch = async (input) =>
      String(input instanceof Request ? input.url : input).startsWith("https://webrisk.")
        ? new Response("quota", { status: 429 })
        : new Response(JSON.stringify({ Status: 0, Answer: [{ data: "93.184.216.34" }] }));
    const dnsOnly = await scoreDestination("https://example.com", env);
    expect(dnsOnly?.score).toBe(0);
    expect(webRiskOutcome(env, dnsOnly)).toBe("failed");
    expect(webRiskOutcome(env, null)).toBe("failed");
    expect(webRiskOutcome({}, dnsOnly)).toBe("off");

    providers({});
    expect(webRiskOutcome(env, await scoreDestination("https://example.com", env))).toBe("clean");
    providers({ threat: { threatTypes: ["MALWARE"] } });
    expect(webRiskOutcome(env, await scoreDestination("https://kit.example/", env))).toBe("hit");
  });

  test("stands on the Web Risk answer alone when the DNS check is down", async () => {
    providers({}, { dnsFails: true });
    const verdict = await scoreDestination("https://example.com", { WEB_RISK_API_KEY: KEY });
    expect(verdict?.provider).toBe(RISK_PROVIDER_WEB_RISK);
    expect(verdict?.score).toBe(0);
  });
});
