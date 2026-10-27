import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, captureEmails, fetchWorker, overrideEnv } from "./support";
import { spendToken } from "../../src/worker/turnstile";

/**
 * Turnstile in front of signup, password reset, the anonymous shortener and
 * the report form (#304). The browser side (script, iframe, CSP)
 * is asserted in tests/e2e/production/csp.pw.ts and exercised by every e2e
 * signup. What is left here is what a browser cannot show: a refused, wrong-
 * action, absent or unverifiable token is turned away, and an unset secret
 * switches the gate off.
 *
 * Cloudflare's siteverify is stubbed; the stub records what we sent it.
 */
/** Turnstile on, with a real-looking (not Cloudflare's test) secret, so the
 * action check runs. APP_HOST is the host these requests go to. */
const ON = () =>
  overrideEnv({
    BETTER_AUTH_SECRET: "test-secret",
    APP_HOST: "localhost",
    TURNSTILE_SITE_KEY: "test-site-key",
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
  });

let sent: URLSearchParams[] = [];

/** Makes siteverify answer `answer`, or fail like an unreachable network. */
type Siteverify = { success: boolean; action?: string; "error-codes"?: string[] };

function siteverify(answer: Siteverify | Error | "not json") {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes("challenges.cloudflare.com")) return real(input, init);
    sent.push(new URLSearchParams(String(init?.body)));
    if (answer instanceof Error) throw answer;
    if (answer === "not json") return new Response("<html>bad gateway</html>", { status: 502 });
    return Response.json(answer);
  });
}

beforeEach(async () => {
  sent = [];
  reset();
  await applyTestMigrations();
  captureEmails({ mx: "deliverable" });
});
afterEach(() => vi.restoreAllMocks());

describe("spending a token", () => {
  it("accepts a token siteverify approves for this scope", async () => {
    siteverify({ success: true, action: "signup" });
    expect(await spendToken(ON(), "signup", "good")).toBe(true);
    expect(sent[0]?.get("secret")).toBe("test-turnstile-secret");
    expect(sent[0]?.get("response")).toBe("good");
    // No visitor address goes to Cloudflare.
    expect(sent[0]?.has("remoteip")).toBe(false);
  });

  it("refuses a token siteverify rejects", async () => {
    siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] });
    expect(await spendToken(ON(), "signup", "spent")).toBe(false);
  });

  it("refuses a token earned on another form", async () => {
    siteverify({ success: true, action: "password-reset" });
    expect(await spendToken(ON(), "signup", "crossed")).toBe(false);
  });

  it("refuses a missing token without asking Cloudflare", async () => {
    siteverify({ success: true, action: "signup" });
    expect(await spendToken(ON(), "signup", "")).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("refuses when siteverify is unreachable", async () => {
    siteverify(new Error("network down"));
    expect(await spendToken(ON(), "signup", "any")).toBe(false);
  });

  it("refuses an approval that names no action", async () => {
    siteverify({ success: true });
    expect(await spendToken(ON(), "signup", "no-action")).toBe(false);
  });

  // Cloudflare's always-pass test secret, which dev, CI and e2e run on.
  const TEST_KEYS = () =>
    overrideEnv({
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    });

  it("accepts Cloudflare's test secret, which never echoes an action", async () => {
    // What siteverify really answers for that secret.
    siteverify({ success: true, "error-codes": [] });
    expect(await spendToken(TEST_KEYS(), "signup", "XXXX.DUMMY.TOKEN.XXXX")).toBe(true);
  });

  it("refuses a test-secret answer that says no", async () => {
    siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await spendToken(TEST_KEYS(), "signup", "XXXX.DUMMY.TOKEN.XXXX")).toBe(false);
  });

  it("does not take siteverify's word that a test key answered", async () => {
    // Our secret is a real one, so an answer claiming to come from a test
    // key still has to name the action.
    siteverify({ success: true });
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () =>
      Response.json({ success: true, metadata: { result_with_testing_key: true } }),
    );
    expect(await spendToken(ON(), "signup", "claims-test")).toBe(false);
  });

  it("refuses when siteverify answers something that is not its JSON", async () => {
    siteverify("not json");
    expect(await spendToken(ON(), "signup", "any")).toBe(false);
  });

  it("is off, and asks nobody, when neither key is set", async () => {
    siteverify({ success: false });
    const off = overrideEnv({ TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined });
    expect(await spendToken(off, "signup", "")).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("refuses everything, and asks nobody, with only one of the two keys", async () => {
    siteverify({ success: true, action: "signup" });
    const siteOnly = overrideEnv({ TURNSTILE_SITE_KEY: "k", TURNSTILE_SECRET_KEY: undefined });
    const secretOnly = overrideEnv({ TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: "s" });
    expect(await spendToken(siteOnly, "signup", "good")).toBe(false);
    expect(await spendToken(secretOnly, "signup", "good")).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

/** One guarded request per route, carrying `token` the way that form does. */
const post = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  fetchWorker(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    ON(),
  );
const byHeader = (token?: string): Record<string, string> =>
  token ? { "x-turnstile-token": token } : {};
const byBody = (token?: string): Record<string, string> => (token ? { turnstileToken: token } : {});

const ROUTES = [
  {
    name: "sign-up",
    action: "signup",
    ok: 200,
    send: (token?: string) =>
      post(
        "/api/auth/sign-up/email",
        {
          email: `probe-${crypto.randomUUID()}@example.com`,
          password: "a-good-password-1",
          name: "probe",
        },
        byHeader(token),
      ),
  },
  {
    name: "password reset",
    action: "password-reset",
    ok: 200,
    send: (token?: string) =>
      post(
        "/api/auth/request-password-reset",
        { email: "someone@example.com", redirectTo: "/reset-password" },
        byHeader(token),
      ),
  },
  {
    name: "the report form",
    action: "report",
    ok: 201,
    send: (token?: string) =>
      post("/api/reports", { link: "sale", reason: "phishing", ...byBody(token) }),
  },
  {
    name: "the anonymous shortener",
    action: "anon-link",
    ok: 201,
    send: (token?: string) =>
      post("/api/shorten", { destination: "https://example.com/scripted", ...byBody(token) }),
  },
] as const;

describe.each(ROUTES)("$name", ({ action, ok, send }) => {
  it("goes through with a token approved for this form", async () => {
    siteverify({ success: true, action });
    expect((await send("good")).status).toBe(ok);
  });

  it("refuses without a token", async () => {
    siteverify({ success: true, action });
    expect((await send()).status).toBe(400);
  });

  it("refuses a token siteverify says no to", async () => {
    // The right action, so only `success` can be what refuses it.
    siteverify({ success: false, action, "error-codes": ["timeout-or-duplicate"] });
    expect((await send("spent")).status).toBe(400);
  });

  it("refuses a token rendered for another form", async () => {
    siteverify({ success: true, action: action === "signup" ? "report" : "signup" });
    expect((await send("crossed")).status).toBe(400);
  });
});

describe("what a refusal leaves behind", () => {
  it("creates no account at sign-up", async () => {
    siteverify({ success: false });
    await post("/api/auth/sign-up/email", {
      email: "notoken@example.com",
      password: "a-good-password-1",
      name: "probe",
    });
    const { results } = await env.DB.prepare("select email from user").all();
    expect(results.map((r) => r.email)).not.toContain("notoken@example.com");
  });

  it("stores no report, and says why in a code the browser retries on", async () => {
    siteverify({ success: false });
    const res = await post("/api/reports", { link: "sale", reason: "phishing" });
    expect(await res.json()).toMatchObject({ code: "TURNSTILE_FAILED" });
    const stored = await env.DB.prepare("select count(*) as n from link_reports").first<{
      n: number;
    }>();
    expect(stored?.n).toBe(0);
  });
});

describe("a site key with no secret", () => {
  const SITE_ONLY = () =>
    overrideEnv({
      BETTER_AUTH_SECRET: "test-secret",
      APP_HOST: "localhost",
      TURNSTILE_SITE_KEY: "test-site-key",
      TURNSTILE_SECRET_KEY: undefined,
    });

  it("serves no site key, so no browser renders a widget nobody checks", async () => {
    const res = await fetchWorker(new Request("http://localhost/api/config"), SITE_ONLY());
    expect(await res.json()).not.toHaveProperty("turnstileSiteKey");
  });

  it("refuses the guarded forms and logs why", async () => {
    siteverify({ success: true, action: "report" });
    // On the request's wide event, which evlog prints outside production.
    const printed = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const res = await fetchWorker(
      new Request("http://localhost/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link: "sale", reason: "phishing", turnstileToken: "good" }),
      }),
      SITE_ONLY(),
    );
    expect(res.status).toBe(400);
    const out = printed.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
    expect(out).toContain("turnstile_misconfigured");
  });

  it("allows nothing from Cloudflare in the CSP", async () => {
    const res = await fetchWorker(new Request("http://localhost/no-such-page"), SITE_ONLY());
    expect(res.headers.get("content-security-policy")).not.toContain("challenges.cloudflare.com");
  });

  it("serves the site key once both are set", async () => {
    const res = await fetchWorker(new Request("http://localhost/api/config"), ON());
    expect(await res.json()).toMatchObject({ turnstileSiteKey: "test-site-key" });
  });
});

describe("the Content-Security-Policy", () => {
  const cspAt = async (url: string, keys: { site?: string; secret?: string }) =>
    (
      await fetchWorker(
        new Request(url, { redirect: "manual" }),
        overrideEnv({
          BETTER_AUTH_SECRET: "test-secret",
          APP_HOST: "localhost",
          SHARED_LINK_HOST: "rdyr.cc",
          TURNSTILE_SITE_KEY: keys.site,
          TURNSTILE_SECRET_KEY: keys.secret,
        }),
      )
    ).headers.get("content-security-policy") ?? "";
  const directive = (csp: string, name: string) =>
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? "";
  const BOTH = { site: "1x00000000000000000000AA", secret: "1x0000000000000000000000000000000AA" };

  it("allows Turnstile's script and iframe on the app host when it is on", async () => {
    const csp = await cspAt("http://localhost/no-such-page", BOTH);
    expect(directive(csp, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(csp, "frame-src")).toBe("frame-src https://challenges.cloudflare.com");
  });

  it("never allows it on the shared link host or a custom domain", async () => {
    for (const url of ["http://rdyr.cc/some-slug", "http://go.example.com/some-slug"]) {
      const csp = await cspAt(url, BOTH);
      expect(csp, url).toContain("script-src 'self'");
      expect(csp, url).not.toContain("challenges.cloudflare.com");
    }
  });

  it("allows nothing from Cloudflare on a copy without the keys", async () => {
    const csp = await cspAt("http://localhost/no-such-page", {});
    expect(csp).not.toContain("challenges.cloudflare.com");
    expect(directive(csp, "frame-src")).toBe("");
  });
});
