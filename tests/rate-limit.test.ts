import { describe, expect, it, mock, spyOn } from "bun:test";
import { Hono } from "hono";
import type { AppEnv, Env, SessionUser } from "../src/worker/env";
import {
  clickAnalyticsAllowed,
  enforcePublicAuthRateLimit,
  enforceSignedApiRateLimit,
  publicAuthGroup,
  publicClientKey,
  rateLimitAllows,
  signedApiGroup,
  writeRateLimitBinding,
} from "../src/worker/rate-limit";

function limiter(success: boolean): RateLimit {
  return {
    limit: mock(async () => ({ success })),
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
    expect(signedApiGroup("/api/orgs/org-1/domains/id/refresh", "POST")).toBe("domain");
    expect(signedApiGroup("/api/billing/checkout", "POST")).toBe("checkout");
    expect(signedApiGroup("/api/billing/portal", "GET")).toBe("checkout");
    expect(signedApiGroup("/api/orgs/org-1/links", "GET")).toBeNull();
  });

  it("uses the higher write binding for either paid plan", () => {
    const free = limiter(true);
    const paid = limiter(true);
    const env = { RL_WRITE_FREE: free, RL_WRITE_PAID: paid } as Env;
    expect(writeRateLimitBinding(env, "free")).toBe(free);
    expect(writeRateLimitBinding(env, "hobby")).toBe(paid);
    expect(writeRateLimitBinding(env, "pro")).toBe(paid);
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
    const env = {
      BETTER_AUTH_SECRET: "test-secret",
      RL_AUTH_PUBLIC: limiter(false),
      RL_EMAIL: limiter(true),
    } as Env;

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

  it("limits free writes and allows the same request through the paid binding", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const free = limiter(false);
    const paid = limiter(true);
    const env = {
      RL_WRITE_FREE: free,
      RL_WRITE_PAID: paid,
    } as Env;

    const limited = await signedWriteApp("free").request(
      "/api/orgs/org-1/links",
      { method: "POST" },
      env,
    );
    expect(limited.status).toBe(429);
    expect(free.limit).toHaveBeenCalledTimes(1);
    expect(paid.limit).not.toHaveBeenCalled();

    const allowed = await signedWriteApp("hobby").request(
      "/api/orgs/org-1/links",
      { method: "POST" },
      env,
    );
    expect(allowed.status).toBe(200);
    expect(paid.limit).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("fails open for API availability but closed for click analytics", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const broken: RateLimit = {
      limit: mock(async () => {
        throw new Error("binding unavailable");
      }),
    };
    expect(
      await rateLimitAllows(broken, "user-1", {
        group: "write",
        method: "POST",
      }),
    ).toBe(true);

    const env = { RL_CLICK_RECORDING: broken } as Env;
    expect(await clickAnalyticsAllowed(env, "org-1")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
