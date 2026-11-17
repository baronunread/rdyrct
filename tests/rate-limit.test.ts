import { describe, expect, it, mock, spyOn } from "bun:test";
import { partialEnv } from "./partial-env";
import { Hono } from "hono";
import {
  clickAnalyticsAllowed,
  enforcePublicAuthRateLimit,
  enforceSignedApiRateLimit,
  publicAuthGroup,
  publicClientKey,
  RATE_LIMIT_POOL,
  RATE_LIMITS,
  type RateLimitBucket,
  rateLimitAllows,
  signedApiGroup,
  writeBucket,
} from "../src/worker/rate-limit";
import { lookup } from "../src/shared/lookup";
import * as v from "valibot";

const ratelimitsSchema = v.optional(
  v.array(
    v.object({ name: v.string(), simple: v.object({ limit: v.number(), period: v.number() }) }),
  ),
);
const wranglerSchema = v.object({
  ratelimits: ratelimitsSchema,
  env: v.record(v.string(), v.object({ ratelimits: ratelimitsSchema })),
});

const bucketOf = (call: RateLimitOptions) => call.key.split(":")[0];

function bucketLimiter(results: Partial<Record<RateLimitBucket, boolean>>) {
  const calls: RateLimitOptions[] = [];
  const RATE_LIMIT: RateLimit = {
    limit: async (options) => {
      calls.push(options);
      return { success: lookup(results, bucketOf(options) ?? "") ?? true };
    },
  };
  return { RATE_LIMIT, calls };
}

// Cloudflare's documented counting: a refused call adds nothing.
function poolCounter(): RateLimit {
  const counts = new Map<string, number>();
  return {
    limit: async ({ key, delta = 1 }) => {
      const count = counts.get(key) ?? 0;
      if (count >= RATE_LIMIT_POOL) return { success: false };
      counts.set(key, count + delta);
      return { success: true };
    },
  };
}

const testUser = (plan: SessionUser["plan"]): SessionUser => ({
  id: "user-1",
  email: "user@example.com",
  name: "Test user",
  isAdmin: false,
  emailVerified: true,
  plan,
  polarSubscriptionCancelAtPeriodEnd: false,
  polarSubscriptionCurrentPeriodEnd: null,
});

function signedWriteApp(plan: SessionUser["plan"]) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("user", testUser(plan));
    await next();
  });
  app.use("*", enforceSignedApiRateLimit);
  app.post("/api/orgs/:orgId/links", (c) => c.json({ ok: true }));
  return app;
}

describe("Cloudflare rate limiting", () => {
  it("groups public email delivery separately from auth and never limits logout", () => {
    expect(publicAuthGroup("/api/auth/sign-in/email")).toBe("auth");
    expect(publicAuthGroup("/api/auth/sign-up/email")).toBe("email");
    expect(publicAuthGroup("/api/auth/email-otp/verify-email")).toBe("auth");
    expect(publicAuthGroup("/api/auth/email-otp/send-verification-otp")).toBe("email");
    expect(publicAuthGroup("/api/auth/request-password-reset")).toBe("email");
    expect(publicAuthGroup("/api/auth/sign-out")).toBeNull();
    expect(publicAuthGroup("/api/auth/get-session")).toBeNull();
  });

  it("groups each costly signed-in route", () => {
    expect(signedApiGroup("/api/orgs/org-1/links", "POST")).toBe("write");
    expect(signedApiGroup("/api/orgs/org-1/qr-logo", "POST")).toBe("qr_upload");
    expect(signedApiGroup("/api/orgs/org-1/domains", "GET")).toBe("domain");
    expect(signedApiGroup("/api/orgs/org-1/domains/id", "GET")).toBe("domain");
    expect(signedApiGroup("/api/billing/checkout", "POST")).toBe("checkout");
    expect(signedApiGroup("/api/billing/portal", "POST")).toBe("checkout");
    expect(signedApiGroup("/api/billing/checkout/abc-123/confirm", "POST")).toBe("checkout");
    expect(signedApiGroup("/api/billing/details", "GET")).toBe("billing_read");
    expect(signedApiGroup("/api/billing/invoices/ord_1", "GET")).toBe("billing_read");
    expect(signedApiGroup("/api/orgs/org-1/links", "GET")).toBeNull();
  });

  it("uses the higher write bucket for either paid plan", () => {
    expect(writeBucket("free")).toBe("write_free");
    expect(writeBucket("hobby")).toBe("write_paid");
    expect(writeBucket("pro")).toBe("write_paid");
  });

  it("builds a stable opaque public key without exposing the address", async () => {
    const request = new Request("https://rdyrct.com/api/auth/sign-in/email", {
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        "user-agent": "rate-limit-test",
      },
    });
    const first = await publicClientKey(request, "test-secret");
    const second = await publicClientKey(request, "test-secret");
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).not.toContain("203.0.113.9");
  });

  it("returns the stable 429 contract for a limited public auth request", async () => {
    const app = new Hono<AppEnv>();
    app.post("/api/auth/*", async (c) => {
      const limited = await enforcePublicAuthRateLimit(c);
      return limited ?? c.json({ ok: true });
    });
    const { RATE_LIMIT } = bucketLimiter({ auth: false });
    const env = partialEnv({ BETTER_AUTH_SECRET: "test-secret", RATE_LIMIT });

    const response = await app.request(
      "/api/auth/sign-in/email",
      { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } },
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      message: "Too many requests. Try again shortly.",
      code: "rate_limited",
    });
  });

  it("uses the email bucket for sign-up email", async () => {
    const app = new Hono<AppEnv>();
    app.post("/api/auth/*", async (c) => {
      const limited = await enforcePublicAuthRateLimit(c);
      return limited ?? c.json({ ok: true });
    });
    const { RATE_LIMIT, calls } = bucketLimiter({ email: false });
    const env = partialEnv({ BETTER_AUTH_SECRET: "test-secret", RATE_LIMIT });

    const response = await app.request(
      "/api/auth/sign-up/email",
      { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9" } },
      env,
    );

    expect(response.status).toBe(429);
    expect(calls.map(bucketOf)).toEqual(["email"]);
  });

  it("limits free writes and allows the same request through the paid bucket", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const { RATE_LIMIT, calls } = bucketLimiter({ write_free: false });
    const env = partialEnv({ RATE_LIMIT });

    const limited = await signedWriteApp("free").request(
      "/api/orgs/org-1/links",
      { method: "POST" },
      env,
    );
    expect(limited.status).toBe(429);

    const allowed = await signedWriteApp("hobby").request(
      "/api/orgs/org-1/links",
      { method: "POST" },
      env,
    );
    expect(allowed.status).toBe(200);
    expect(calls.map(bucketOf)).toEqual(["write_free", "write_paid"]);
    logged.mockRestore();
  });

  it("fails open for API availability but closed for click analytics", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const broken: RateLimit = {
      limit: mock(async () => {
        throw new Error("binding unavailable");
      }),
    };
    const env = partialEnv({ RATE_LIMIT: broken });
    expect(
      await rateLimitAllows(env, "write_free", "user-1", {
        group: "write",
        method: "POST",
      }),
    ).toBe(true);

    expect(await clickAnalyticsAllowed(env, "org-1")).toBe(false);
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

describe("one weighted binding for every limit", () => {
  // SAFETY: RATE_LIMITS is an `as const` literal whose keys are exactly
  // RateLimitBucket; Object.keys only loses that to `string[]`.
  const buckets = Object.keys(RATE_LIMITS) as RateLimitBucket[];

  it("keeps the pool a whole multiple of every limit, so each delta is an integer", () => {
    for (const bucket of buckets) expect(RATE_LIMIT_POOL % RATE_LIMITS[bucket]).toBe(0);
  });

  it("sets the binding's limit to the pool in every environment", async () => {
    const config = v.parse(
      wranglerSchema,
      Bun.JSONC.parse(await Bun.file("wrangler.jsonc").text()),
    );
    const pools = [config, ...Object.values(config.env)]
      .flatMap((section) => section.ratelimits ?? [])
      .map((binding) => [binding.name, binding.simple.limit, binding.simple.period]);
    expect(pools).toEqual([
      ["RATE_LIMIT", RATE_LIMIT_POOL, 60],
      ["RATE_LIMIT", RATE_LIMIT_POOL, 60],
    ]);
  });

  it("lets each bucket through exactly its own limit a minute", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const env = partialEnv({ RATE_LIMIT: poolCounter() });
    for (const bucket of buckets) {
      let allowed = 0;
      while (await rateLimitAllows(env, bucket, "caller", { group: "write", method: "POST" }))
        allowed++;
      expect([bucket, allowed]).toEqual([bucket, RATE_LIMITS[bucket]]);
    }
    logged.mockRestore();
  });
});
