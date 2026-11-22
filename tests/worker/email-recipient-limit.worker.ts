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
  rateLimits,
  recordingLimit,
} from "./support";
import type { JsonValue } from "../../src/shared/types";

const RESET_PATH = "/api/auth/email-otp/request-password-reset";

// `callerIp` fills cf-connecting-ip, the only input to the per-caller key.
// Without it every request looks like one caller, and a limiter keyed on the
// caller by mistake would pass the distributed-caller cases below.
async function requestReset(
  testEnv: Env,
  email: JsonValue,
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
    const testEnv = overrideEnv(
      rateLimits({ email: openLimit(), auth: openLimit(), email_recipient: exhaustedLimit() }),
    );

    const res = await requestReset(testEnv, "victim@example.com");

    expect(res.status).toBe(429);
  });

  it("is indistinguishable from the caller limit, so it leaks no account state", async () => {
    const callerLimited = await requestReset(
      overrideEnv(rateLimits({ email: exhaustedLimit(), email_recipient: openLimit() })),
      "victim@example.com",
    );
    const recipientLimited = await requestReset(
      overrideEnv(rateLimits({ email: openLimit(), email_recipient: exhaustedLimit() })),
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
    const testEnv = overrideEnv(
      rateLimits({
        email: recordingLimit(callerKeys),
        email_recipient: recordingLimit(recipientKeys),
      }),
    );

    // The callers' keys have to differ for "the recipient key is the same
    // anyway" to mean anything.
    await requestReset(testEnv, "victim@example.com", "203.0.113.7");
    // No padding: better-auth 1.7.27 refuses an address with spaces round it.
    await requestReset(testEnv, "VICTIM@Example.com", "198.51.100.4");

    expect(callerKeys).toHaveLength(2);
    expect(callerKeys[0]).not.toBe(callerKeys[1]);
    expect(recipientKeys).toHaveLength(2);
    expect(recipientKeys[0]).toBe(recipientKeys[1]);
  });

  it("stops a second caller once the recipient's budget is gone", async () => {
    const spent = new Set<string>();
    const recipientBudgetOfOne: RateLimit = {
      limit: async (options) => {
        const key = String(options?.key);
        const success = !spent.has(key);
        spent.add(key);
        return { success };
      },
    };
    const testEnv = overrideEnv(
      rateLimits({ email: openLimit(), email_recipient: recipientBudgetOfOne }),
    );

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
    const testEnv = overrideEnv(
      rateLimits({ email: openLimit(), email_recipient: recordingLimit(keys) }),
    );

    await requestReset(testEnv, "one@example.com");
    await requestReset(testEnv, "two@example.com");

    expect(keys[0]).not.toBe(keys[1]);
  });

  it("never puts the raw address in the rate-limit key", async () => {
    const keys: string[] = [];
    const testEnv = overrideEnv(
      rateLimits({ email: openLimit(), email_recipient: recordingLimit(keys) }),
    );

    await requestReset(testEnv, "victim@example.com");

    expect(keys[0]).not.toContain("victim");
    expect(keys[0]).not.toContain("example.com");
  });

  it("does not consume a recipient budget when the body names no address", async () => {
    const keys: string[] = [];
    const testEnv = overrideEnv(
      rateLimits({ email: openLimit(), email_recipient: recordingLimit(keys) }),
    );

    await requestReset(testEnv, 42);

    expect(keys).toHaveLength(0);
  });

  it("leaves the body readable for the auth handler downstream", async () => {
    // The limiter clones the request to read `email`; consuming the original
    // would hand BetterAuth an empty body and skip its "user not found" path.
    const res = await requestReset(authEnv(), "nobody@example.com");

    expect(res.status).toBeLessThan(500);
  });
});
