import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import type { Env } from "../../src/worker/env";
import { applyTestMigrations, authEnv, overrideEnv } from "./support";

const RESET_PATH = "/api/auth/email-otp/request-password-reset";

/**
 * A rate-limit binding that always refuses, so a route's behaviour once a
 * budget is gone can be asserted without spending real tokens against
 * Cloudflare's per-location counters (which the test runner does not reset
 * between cases).
 */
function exhaustedLimit(): RateLimit {
  return { limit: async () => ({ success: false }) } as unknown as RateLimit;
}

/** A binding that always allows, isolating which of the two budgets is
 * under test. */
function openLimit(): RateLimit {
  return { limit: async () => ({ success: true }) } as unknown as RateLimit;
}

function recordingLimit(keys: string[]): RateLimit {
  return {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: true };
    },
  } as unknown as RateLimit;
}

async function requestReset(testEnv: Env, email: unknown): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost${RESET_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    const keys: string[] = [];
    const testEnv = overrideEnv({
      RL_EMAIL: openLimit(),
      RL_EMAIL_RECIPIENT: recordingLimit(keys),
    });

    // Same recipient, different callers: Cloudflare fills cf-connecting-ip,
    // and the caller key is an HMAC of it, so what matters is that the
    // recipient key is identical across both.
    await requestReset(testEnv, "victim@example.com");
    await requestReset(testEnv, "VICTIM@Example.com  ");

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
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
