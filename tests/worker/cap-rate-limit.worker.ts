import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import type { Env } from "../../src/worker/env";
import {
  applyTestMigrations,
  exhaustedLimit,
  openLimit,
  overrideEnv,
  recordingLimit,
} from "./support";

/**
 * Cap's endpoints spend their own budget, not signup's (#98).
 *
 * They were briefly counted against RL_AUTH_PUBLIC, which is the worst place
 * for them: a person fills the form, the widget asks for a challenge, the
 * counter is out, and the browser can produce no token at all. What they then
 * see is "could not verify you are human", which reads as an accusation
 * rather than as "wait a minute" — and the built-in retry spends two more
 * requests against the same exhausted budget, so it never helps.
 *
 * The counters are asserted through stub bindings rather than by spending
 * real ones: Cloudflare's per-location counters do not reset between cases.
 */

async function post(testEnv: Env, path: string, body: unknown = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify(body),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const CAP_ON = (overrides: Partial<Env>) =>
  overrideEnv({
    BETTER_AUTH_SECRET: "test-secret",
    CAP_SECRET: "cap-test-secret-long-enough-to-be-accepted",
    ...overrides,
  });

beforeEach(applyTestMigrations);
afterEach(reset);

describe("the budget Cap spends", () => {
  it("keeps issuing challenges when the signup budget is gone", async () => {
    // The case that took signup down: somebody who has been trying to log in
    // must still be able to prove they are human.
    const res = await post(
      CAP_ON({ RL_AUTH_PUBLIC: exhaustedLimit(), RL_CAP: openLimit() }),
      "/api/cap/signup/challenge",
    );
    expect(res.status).toBe(200);
  });

  it("refuses when its own budget is gone", async () => {
    const res = await post(
      CAP_ON({ RL_AUTH_PUBLIC: openLimit(), RL_CAP: exhaustedLimit() }),
      "/api/cap/signup/challenge",
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("x-ratelimit-group")).toBe("cap");
  });

  it("counts a challenge and a redeem separately, per caller", async () => {
    const keys: string[] = [];
    const env = CAP_ON({ RL_AUTH_PUBLIC: openLimit(), RL_CAP: recordingLimit(keys) });

    await post(env, "/api/cap/signup/challenge");
    await post(env, "/api/cap/signup/redeem", { token: "x", solutions: [] });

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    // The caller is a keyed digest, never the address itself.
    for (const key of keys) {
      expect(key.startsWith("cap:")).toBe(true);
      expect(key).not.toContain("203.0.113.7");
    }
  });

  it("leaves the auth routes on the auth budget", async () => {
    // Sign-up is not the example here: it sends mail, so it spends the email
    // budget. Sign-in is the plain auth case.
    const res = await post(
      CAP_ON({ RL_AUTH_PUBLIC: exhaustedLimit(), RL_CAP: openLimit() }),
      "/api/auth/sign-in/email",
      { email: "someone@example.com", password: "a-good-password-1" },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("x-ratelimit-group")).toBe("auth");
  });
});
