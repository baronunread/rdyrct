import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import type { Env } from "../../src/worker/env";
import {
  applyTestMigrations,
  authEnv,
  exhaustedLimit,
  openLimit,
  overrideEnv,
  recordingLimit,
} from "./support";

const RESET_PATH = "/api/auth/email-otp/request-password-reset";

/**
 * One password-reset request. `callerIp` fills cf-connecting-ip, which is
 * the only input to the per-caller key: without it every request in a test
 * looks like the same caller, and a limiter that keyed on the caller by
 * mistake would pass the distributed-caller cases below.
 */
async function requestReset(
  testEnv: Env,
  email: unknown,
  callerIp = "203.0.113.1",
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost${RESET_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": callerIp },
      body: JSON.stringify({ email }),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

beforeEach(applyTestMigrations);
afterEach(reset);

describe("recipient-keyed email rate limit (#50)", () => {
  it("refuses a send once the recipient's budget is gone, even though the caller's is not", async () => {
    const testEnv = overrideEnv({
      RL_EMAIL: openLimit(),
      RL_AUTH_PUBLIC: openLimit(),
      RL_EMAIL_RECIPIENT: exhaustedLimit(),
    });

    const res = await requestReset(testEnv, "victim@example.com");

    expect(res.status).toBe(429);
  });

  it("is indistinguishable from the caller limit, so it leaks no account state", async () => {
    const callerLimited = await requestReset(
      overrideEnv({ RL_EMAIL: exhaustedLimit(), RL_EMAIL_RECIPIENT: openLimit() }),
      "victim@example.com",
    );
    const recipientLimited = await requestReset(
      overrideEnv({ RL_EMAIL: openLimit(), RL_EMAIL_RECIPIENT: exhaustedLimit() }),
      "victim@example.com",
    );

    expect(recipientLimited.status).toBe(callerLimited.status);
    expect(recipientLimited.headers.get("x-ratelimit-group")).toBe(
      callerLimited.headers.get("x-ratelimit-group"),
    );
    expect(await recipientLimited.json()).toEqual(await callerLimited.json());
  });

  it("keys on the recipient, not the caller, so distributed callers share one budget", async () => {
    const callerKeys: string[] = [];
    const recipientKeys: string[] = [];
    const testEnv = overrideEnv({
      RL_EMAIL: recordingLimit(callerKeys),
      RL_EMAIL_RECIPIENT: recordingLimit(recipientKeys),
    });

    // One recipient, two callers. Recording both budgets' keys is what makes
    // this an assertion rather than a coincidence: the callers have to come
    // out different for "the recipient key is the same anyway" to mean
    // anything.
    await requestReset(testEnv, "victim@example.com", "203.0.113.7");
    await requestReset(testEnv, "VICTIM@Example.com  ", "198.51.100.4");

    expect(callerKeys).toHaveLength(2);
    expect(callerKeys[0]).not.toBe(callerKeys[1]);
    expect(recipientKeys).toHaveLength(2);
    expect(recipientKeys[0]).toBe(recipientKeys[1]);
  });

  it("stops a second caller once the recipient's budget is gone", async () => {
    // The behaviour the key assertion above implies, spelled out: a fresh
    // caller with its own untouched per-caller budget still gets refused,
    // because the budget that ran out belongs to the address.
    const spent = new Set<string>();
    const recipientBudgetOfOne: RateLimit = {
      limit: async ({ key }: { key: string }) => {
        const success = !spent.has(key);
        spent.add(key);
        return { success };
      },
    } as unknown as RateLimit;
    const testEnv = overrideEnv({
      RL_EMAIL: openLimit(),
      RL_EMAIL_RECIPIENT: recipientBudgetOfOne,
    });

    const first = await requestReset(testEnv, "victim@example.com", "203.0.113.7");
    const second = await requestReset(testEnv, "victim@example.com", "198.51.100.4");
    const other = await requestReset(testEnv, "bystander@example.com", "198.51.100.4");

    expect(first.status).not.toBe(429);
    expect(second.status).toBe(429);
    // The bystander shares the second caller's IP, so only a recipient-keyed
    // budget lets this one through.
    expect(other.status).not.toBe(429);
  });

  it("gives a different recipient its own budget", async () => {
    const keys: string[] = [];
    const testEnv = overrideEnv({
      RL_EMAIL: openLimit(),
      RL_EMAIL_RECIPIENT: recordingLimit(keys),
    });

    await requestReset(testEnv, "one@example.com");
    await requestReset(testEnv, "two@example.com");

    expect(keys[0]).not.toBe(keys[1]);
  });

  it("never puts the raw address in the rate-limit key", async () => {
    const keys: string[] = [];
    const testEnv = overrideEnv({
      RL_EMAIL: openLimit(),
      RL_EMAIL_RECIPIENT: recordingLimit(keys),
    });

    await requestReset(testEnv, "victim@example.com");

    expect(keys[0]).not.toContain("victim");
    expect(keys[0]).not.toContain("example.com");
  });

  it("does not consume a recipient budget when the body names no address", async () => {
    const keys: string[] = [];
    const testEnv = overrideEnv({
      RL_EMAIL: openLimit(),
      RL_EMAIL_RECIPIENT: recordingLimit(keys),
    });

    await requestReset(testEnv, 42);

    expect(keys).toHaveLength(0);
  });

  it("leaves the body readable for the auth handler downstream", async () => {
    // The limiter clones the request to look at `email`. If it consumed the
    // original stream instead, BetterAuth would receive an empty body and
    // this would not reach its "user not found" path at all.
    const res = await requestReset(authEnv(), "nobody@example.com");

    expect(res.status).toBeLessThan(500);
  });
});
