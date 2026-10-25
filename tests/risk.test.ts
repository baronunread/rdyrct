import { afterEach, describe, expect, test } from "bun:test";
import type { JsonValue } from "../src/shared/types";
import {
  isWebRiskHit,
  RISK_PROVIDER_DNS,
  RISK_PROVIDER_WEB_RISK,
  askWebRisk,
  scoreDestination,
  scoreDestinationWithWebRisk,
  WEB_RISK_MAX_URI,
  webRiskUri,
  webRiskUriLength,
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
    });
  });

  test("is skipped without a key, so a fork with none never calls Google", async () => {
    const calls = providers({ threat: { threatTypes: ["MALWARE"] } });
    const { verdict, webRisk } = await scoreDestinationWithWebRisk("https://kit.example/", {});
    expect(calls).toHaveLength(0);
    expect(verdict?.provider).toBe(RISK_PROVIDER_DNS);
    expect(webRisk).toBe("off");
  });

  test("falls back to the DNS answer when Web Risk is down", async () => {
    providers("fail");
    const { verdict, webRisk } = await scoreDestinationWithWebRisk("https://example.com", {
      WEB_RISK_API_KEY: KEY,
    });
    expect(verdict?.provider).toBe(RISK_PROVIDER_DNS);
    expect(webRisk).toBe("failed");
  });

  test("tells a Google error apart from a DNS-only answer and a clean one", async () => {
    const env = { WEB_RISK_API_KEY: KEY };
    globalThis.fetch = async (input) =>
      String(input instanceof Request ? input.url : input).startsWith("https://webrisk.")
        ? new Response("quota", { status: 429 })
        : new Response(JSON.stringify({ Status: 0, Answer: [{ data: "93.184.216.34" }] }));
    const dnsOnly = await scoreDestinationWithWebRisk("https://example.com", env);
    expect(dnsOnly.verdict?.score).toBe(0);
    expect(dnsOnly.webRisk).toBe("failed");
    expect((await scoreDestinationWithWebRisk("https://example.com", {})).webRisk).toBe("off");

    providers({});
    expect((await scoreDestinationWithWebRisk("https://example.com", env)).webRisk).toBe("clean");
    providers({ threat: { threatTypes: ["MALWARE"] } });
    expect((await scoreDestinationWithWebRisk("https://kit.example/", env)).webRisk).toBe("hit");
  });

  test("stands on the Web Risk answer alone when the DNS check is down", async () => {
    providers({}, { dnsFails: true });
    const verdict = await scoreDestination("https://example.com", { WEB_RISK_API_KEY: KEY });
    expect(verdict?.provider).toBe(RISK_PROVIDER_WEB_RISK);
    expect(verdict?.score).toBe(0);
  });
});

/**
 * What Google is asked, and how often (#341 review). A destination has no
 * length cap, so the URI has to have one; and each lookup counts against a
 * monthly quota, so a repeated URI must not cost a second call.
 */
describe("asking Web Risk", () => {
  const KEY = "test-web-risk-key";

  /** Google answers `answer` and records each URI it was asked about. */
  function google(answer: JsonValue) {
    const asked: string[] = [];
    globalThis.fetch = async (input) => {
      asked.push(
        new URL(String(input instanceof Request ? input.url : input)).searchParams.get("uri") ?? "",
      );
      return new Response(JSON.stringify(answer));
    };
    return asked;
  }

  /** A KV namespace in a Map, recording each TTL it was given. */
  function memoryKv() {
    const store = new Map<string, string>();
    const ttls: number[] = [];
    return {
      store,
      ttls,
      async get(key: string) {
        const raw = store.get(key);
        return raw === undefined ? null : JSON.parse(raw);
      },
      async put(key: string, value: string, options?: { expirationTtl?: number }) {
        store.set(key, value);
        ttls.push(options?.expirationTtl ?? 0);
      },
    };
  }

  test("drops the fragment and any user:password, and keeps a short query", () => {
    expect(webRiskUri("https://me:secret@kit.example/login?x=1#top")).toBe(
      "https://kit.example/login?x=1",
    );
    expect(webRiskUri("mailto:someone@example.com")).toBeNull();
  });

  test("drops a query too long to send, then the path, so the lookup still runs", () => {
    const longQuery = `https://kit.example/login?${"a".repeat(20_000)}`;
    expect(webRiskUri(longQuery)).toBe("https://kit.example/login");
    const longPath = `https://kit.example/${"p".repeat(20_000)}?x=1`;
    expect(webRiskUri(longPath)).toBe("https://kit.example/");
    for (const url of [longQuery, longPath])
      expect(webRiskUriLength(webRiskUri(url) ?? "")).toBeLessThanOrEqual(WEB_RISK_MAX_URI);
  });

  test("measures the URI as it is sent, so characters that encode long cannot pad past the cap", async () => {
    // 8,000 "&" pass a check on the raw URL and become a 24 KB request, which
    // Google answers with a 400: the lookup failed and the link went through.
    const ampersands = `https://kit.example/login?${"&".repeat(8000)}`;
    expect(ampersands.length).toBeLessThan(WEB_RISK_MAX_URI);
    expect(webRiskUri(ampersands)).toBe("https://kit.example/login");
    // "%41" stays three characters in the URL and goes as five.
    const escapes = `https://hacked.example/wp-content/phish/${"%41".repeat(2500)}`;
    expect(escapes.length).toBeLessThan(WEB_RISK_MAX_URI);
    expect(webRiskUri(escapes)).toBe("https://hacked.example/wp-content/phish/");

    const asked = google({ threat: { threatTypes: ["SOCIAL_ENGINEERING"] } });
    for (const url of [ampersands, escapes])
      expect((await webRiskVerdict(url, KEY))?.score).toBe(100);
    for (const uri of asked) expect(webRiskUriLength(uri)).toBeLessThanOrEqual(WEB_RISK_MAX_URI);
  });

  test("keeps a padded listed path's leading segments, never just the host", async () => {
    // Padding a listed path past the cap used to fall back to the host, which
    // Google answers clean while the path is what it lists.
    const pad = "a".repeat(WEB_RISK_MAX_URI);
    expect(webRiskUri(`https://hacked.example/wp-content/phish/${pad}`)).toBe(
      "https://hacked.example/wp-content/phish/",
    );
    // Three segments: Web Risk checks the host plus four path prefixes.
    expect(webRiskUri(`https://hacked.example/a/b/c/d/${pad}?q=1`)).toBe(
      "https://hacked.example/a/b/c/",
    );
    // A query up to the cap is still sent whole.
    const query = `https://kit.example/login?${"q".repeat(6000)}`;
    expect(webRiskUri(query)).toBe(query);
  });

  test("keeps Google's answer when the cache write fails", async () => {
    google({ threat: { threatTypes: ["MALWARE"] } });
    const LINKS = memoryKv();
    LINKS.put = async () => {
      throw new Error("KV PUT failed: 429 Too Many Requests");
    };
    const { outcome, verdict } = await askWebRisk(
      { WEB_RISK_API_KEY: KEY, LINKS },
      "https://kit.example/",
    );
    expect(outcome).toBe("hit");
    expect(verdict?.score).toBe(100);
  });

  test("asks Google about the shortened form of a long destination", async () => {
    const asked = google({ threat: { threatTypes: ["SOCIAL_ENGINEERING"] } });
    const verdict = await webRiskVerdict(`https://kit.example/login?${"a".repeat(20_000)}`, KEY);
    expect(asked).toEqual(["https://kit.example/login"]);
    expect(verdict?.score).toBe(100);
  });

  test("answers a repeated URI from the cache, without a second call", async () => {
    const asked = google({});
    const LINKS = memoryKv();
    const env = { WEB_RISK_API_KEY: KEY, LINKS };
    expect((await askWebRisk(env, "https://example.com/a")).outcome).toBe("clean");
    expect((await askWebRisk(env, "https://example.com/a#other")).outcome).toBe("clean");
    expect(asked).toHaveLength(1);
    // Hashed: no destination is readable in a key listing.
    expect([...LINKS.store.keys()].join()).not.toContain("example.com");
  });

  test("keeps a hit until a minute before Google's expireTime", async () => {
    const expireTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    google({ threat: { threatTypes: ["MALWARE"], expireTime } });
    const LINKS = memoryKv();
    expect(
      (await askWebRisk({ WEB_RISK_API_KEY: KEY, LINKS }, "https://kit.example/")).outcome,
    ).toBe("hit");
    // A minute short of it: KV's edge can serve a value about that long stale.
    expect(LINKS.ttls[0]).toBeGreaterThan(8 * 60);
    expect(LINKS.ttls[0]).toBeLessThanOrEqual(9 * 60);
  });

  test("keeps a hit no longer than Google's terms allow", async () => {
    // §47: refreshed before expireTime, or within 30 minutes without one.
    google({ threat: { threatTypes: ["MALWARE"] } });
    const LINKS = memoryKv();
    await askWebRisk({ WEB_RISK_API_KEY: KEY, LINKS }, "https://kit.example/a");
    expect(LINKS.ttls).toEqual([29 * 60]);

    // Due to expire within two minutes: a minute short of that is under KV's
    // 60 second minimum, so it is not cached at all.
    const soon = new Date(Date.now() + 100_000).toISOString();
    google({ threat: { threatTypes: ["MALWARE"], expireTime: soon } });
    const short = memoryKv();
    const { outcome } = await askWebRisk(
      { WEB_RISK_API_KEY: KEY, LINKS: short },
      "https://kit.example/b",
    );
    expect(outcome).toBe("hit");
    expect(short.store.size).toBe(0);
  });

  test("spends the budget only on a call to Google, and skips the call past it", async () => {
    const asked = google({});
    const LINKS = memoryKv();
    const env = { WEB_RISK_API_KEY: KEY, LINKS };
    let spent = 0;
    const spend = async () => ++spent <= 1;
    expect((await askWebRisk(env, "https://example.com/a", spend)).outcome).toBe("clean");
    // Cached: no spend, no call.
    expect((await askWebRisk(env, "https://example.com/a", spend)).outcome).toBe("clean");
    expect(spent).toBe(1);
    expect((await askWebRisk(env, "https://example.com/b", spend)).outcome).toBe("over_budget");
    expect(asked).toEqual(["https://example.com/a"]);
  });
});
