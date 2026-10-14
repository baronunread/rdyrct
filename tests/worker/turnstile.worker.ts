import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, captureEmails, fetchWorker, overrideEnv } from "./support";
import { spendToken } from "../../src/worker/turnstile";

/**
 * Turnstile in front of signup (#304). The browser side (script, iframe, CSP)
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
type Siteverify = { success: boolean; action?: string; "error-codes"?: string[] };

function siteverify(answer: Siteverify | Error) {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes("challenges.cloudflare.com")) return real(input, init);
    sent.push(new URLSearchParams(String(init?.body)));
    if (answer instanceof Error) throw answer;
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
