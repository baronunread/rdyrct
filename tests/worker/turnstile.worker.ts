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
const ON = () =>
  overrideEnv({ BETTER_AUTH_SECRET: "test-secret", TURNSTILE_SECRET_KEY: "test-turnstile-secret" });

let sent: URLSearchParams[] = [];

/** Makes siteverify answer `answer`, or fail like an unreachable network. */
type Siteverify = {
  success: boolean;
  action?: string;
  "error-codes"?: string[];
  metadata?: { result_with_testing_key?: boolean };
};

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

function signUp(email: string, headers: Record<string, string> = {}) {
  return fetchWorker(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ email, password: "a-good-password-1", name: "probe" }),
    }),
    ON(),
  );
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

  it("accepts Cloudflare's test keys, which never echo an action", async () => {
    // What siteverify really answers for the always-pass test secret that
    // dev, CI and e2e run on.
    siteverify({ success: true, "error-codes": [], metadata: { result_with_testing_key: true } });
    expect(await spendToken(ON(), "signup", "XXXX.DUMMY.TOKEN.XXXX")).toBe(true);
  });

  it("refuses a test-key answer that says no", async () => {
    siteverify({
      success: false,
      "error-codes": ["invalid-input-response"],
      metadata: { result_with_testing_key: true },
    });
    expect(await spendToken(ON(), "signup", "XXXX.DUMMY.TOKEN.XXXX")).toBe(false);
  });

  it("refuses when siteverify answers something that is not its JSON", async () => {
    siteverify("not json");
    expect(await spendToken(ON(), "signup", "any")).toBe(false);
  });

  it("is off, and asks nobody, when no secret is set", async () => {
    siteverify({ success: false });
    const off = overrideEnv({ TURNSTILE_SECRET_KEY: undefined });
    expect(await spendToken(off, "signup", "")).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

describe("at signup", () => {
  it("creates the account for an approved token", async () => {
    siteverify({ success: true, action: "signup" });
    const res = await signUp("fresh@example.com", { "x-turnstile-token": "good" });
    expect(res.status).toBe(200);
  });

  it("refuses without a token, and creates no account", async () => {
    siteverify({ success: true, action: "signup" });
    const res = await signUp("notoken@example.com");
    expect(res.status).toBe(400);
    const { results } = await env.DB.prepare("select email from user").all();
    expect(results.map((r) => r.email)).not.toContain("notoken@example.com");
  });

  it("refuses a token siteverify rejects", async () => {
    siteverify({ success: false });
    expect((await signUp("bad@example.com", { "x-turnstile-token": "bad" })).status).toBe(400);
  });
});

describe("at password reset", () => {
  const requestReset = (headers: Record<string, string> = {}) =>
    fetchWorker(
      new Request("http://localhost/api/auth/request-password-reset", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ email: "someone@example.com", redirectTo: "/reset-password" }),
      }),
      ON(),
    );

  it("refuses without a token", async () => {
    siteverify({ success: true, action: "password-reset" });
    expect((await requestReset()).status).toBe(400);
  });

  it("refuses a token earned on the signup form", async () => {
    siteverify({ success: true, action: "signup" });
    expect((await requestReset({ "x-turnstile-token": "crossed" })).status).toBe(400);
  });

  it("goes through with a token for this form", async () => {
    siteverify({ success: true, action: "password-reset" });
    expect((await requestReset({ "x-turnstile-token": "good" })).status).toBe(200);
  });
});

describe("the public forms outside better-auth", () => {
  const post = (path: string, body: Record<string, string>) =>
    fetchWorker(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      ON(),
    );
  const report = (turnstileToken?: string) =>
    post("/api/reports", {
      link: "sale",
      reason: "phishing",
      ...(turnstileToken && { turnstileToken }),
    });
  const shorten = (turnstileToken?: string) =>
    post("/api/shorten", {
      destination: "https://example.com/scripted",
      ...(turnstileToken && { turnstileToken }),
    });

  it("refuses a report without a token, and stores nothing", async () => {
    siteverify({ success: true, action: "report" });
    const res = await report();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "TURNSTILE_FAILED" });
    const stored = await env.DB.prepare("select count(*) as n from link_reports").first<{
      n: number;
    }>();
    expect(stored?.n).toBe(0);
  });

  it("takes a report with a token for the report form", async () => {
    siteverify({ success: true, action: "report" });
    expect((await report("good")).status).toBe(201);
  });

  it("refuses an anonymous link without a token", async () => {
    siteverify({ success: true, action: "anon-link" });
    const res = await shorten();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "TURNSTILE_FAILED" });
  });

  it("refuses an anonymous link with a token from another form", async () => {
    siteverify({ success: true, action: "report" });
    expect((await shorten("crossed")).status).toBe(400);
  });
});

describe("the Content-Security-Policy", () => {
  const cspWith = async (siteKey: string | undefined) =>
    (
      await fetchWorker(
        new Request("http://localhost/no-such-page"),
        overrideEnv({ BETTER_AUTH_SECRET: "test-secret", TURNSTILE_SITE_KEY: siteKey }),
      )
    ).headers.get("content-security-policy") ?? "";
  const directive = (csp: string, name: string) =>
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? "";

  it("allows Turnstile's script and iframe when a site key is served", async () => {
    const csp = await cspWith("1x00000000000000000000AA");
    expect(directive(csp, "script-src")).toContain("https://challenges.cloudflare.com");
    expect(directive(csp, "frame-src")).toBe("frame-src https://challenges.cloudflare.com");
  });

  it("allows nothing from Cloudflare on a copy without the keys", async () => {
    const csp = await cspWith(undefined);
    expect(csp).not.toContain("challenges.cloudflare.com");
    expect(directive(csp, "frame-src")).toBe("");
  });
});
