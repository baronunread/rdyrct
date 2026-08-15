import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Webhook } from "standardwebhooks";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import {
  adminCookie,
  applyTestMigrations,
  billingEnv,
  jsonBody,
  overrideEnv,
  POLAR_HOBBY_PRODUCT_ID,
  POLAR_PRO_PRODUCT_ID,
  POLAR_WEBHOOK_SECRET,
  seedBillingUser as seedUser,
} from "./support";
import type { Env } from "../../src/worker/env";
import type { JsonValue } from "../../src/shared/types";
import type { BillingProvider } from "../../src/worker/billing-provider";

// The real Polar client makes real HTTP calls and expects a large,
// version-specific response schema back. The routes take their client off the
// env (see BillingProvider), so these tests hand them a stand-in the same way
// they hand over a queue or a rate limiter, and stay about our own route
// logic.
const checkoutsCreate = vi.fn(async () => ({ url: "https://sandbox.polar.sh/checkout/test" }));
const customerSessionsCreate = vi.fn(async () => ({
  customerPortalUrl: "https://sandbox.polar.sh/portal/test",
}));
const billingProvider: BillingProvider = {
  checkouts: { create: checkoutsCreate },
  customerSessions: { create: customerSessionsCreate },
};

/** billingEnv() with the stand-in checkout/portal client wired in. */
const polarEnv = (): Env => ({ ...billingEnv(), BILLING: billingProvider });

beforeEach(async () => {
  await applyTestMigrations();
  checkoutsCreate.mockClear();
  customerSessionsCreate.mockClear();
});

afterEach(async () => {
  await reset();
});

function db() {
  return drizzle(env.DB, { schema });
}

async function getUser() {
  const rows = await db().select().from(schema.user).where(eq(schema.user.id, "user-1"));
  return rows[0];
}

async function checkout(cookie: string, body: JsonValue): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/billing/checkout", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    polarEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function portal(cookie?: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/billing/portal", {
      headers: cookie ? { cookie } : {},
    }),
    polarEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

let nextMsgId = 0;

/** Signs a Polar webhook payload the same way `standardwebhooks` verifies
 * it, so posting through the real handler round-trips correctly. Each call
 * gets its own delivery id, matching real Polar/Svix deliveries, which never
 * reuse one across distinct events. */
function signPayload(payload: string) {
  return signPayloadWithId(payload, `msg-${++nextMsgId}`);
}

/** Same as signPayload, but with an explicit delivery id: for tests that
 * simulate a redelivered (or spoofed-id) webhook. */
function signPayloadWithId(payload: string, msgId: string) {
  const timestamp = new Date();
  const signature = new Webhook(btoa(POLAR_WEBHOOK_SECRET)).sign(msgId, timestamp, payload);
  return {
    "webhook-id": msgId,
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": signature,
  };
}

/** The standard subscription.active payload the redelivery tests build a
 * scenario on top of. */
function subscriptionActivePayload(): string {
  return JSON.stringify({
    type: "subscription.active",
    data: {
      id: "sub_1",
      customer_id: "cus_1",
      product_id: POLAR_PRO_PRODUCT_ID,
      metadata: { userId: "user-1" },
    },
  });
}

async function postWebhook(
  event: JsonValue,
  headers?: Record<string, string>,
  testEnv: Env = polarEnv(),
): Promise<Response> {
  const payload = JSON.stringify(event);
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/webhooks/polar", {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? signPayload(payload)) },
      body: payload,
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST /api/billing/checkout", () => {
  it("defaults to the pro plan and returns the checkout url", async () => {
    const cookie = await adminCookie();
    const res = await checkout(cookie, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://sandbox.polar.sh/checkout/test" });
    expect(checkoutsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [POLAR_PRO_PRODUCT_ID],
        successUrl: "http://localhost/billing?checkout_id={CHECKOUT_ID}",
        customerEmail: "admin@example.com",
        metadata: { userId: "admin-1" },
      }),
    );
  });

  it("maps the hobby plan to the hobby product", async () => {
    const cookie = await adminCookie();
    await checkout(cookie, { plan: "hobby" });
    expect(checkoutsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ products: [POLAR_HOBBY_PRODUCT_ID] }),
    );
  });

  it("rejects a plan that isn't hobby or pro", async () => {
    const cookie = await adminCookie();
    const res = await checkout(cookie, { plan: "diamond" });
    expect(res.status).toBe(400);
    expect(checkoutsCreate).not.toHaveBeenCalled();
  });

  it("requires sign-in", async () => {
    const res = await checkout("", {});
    expect(res.status).toBe(401);
    expect(checkoutsCreate).not.toHaveBeenCalled();
  });
});

describe("GET /api/billing/portal", () => {
  it("requires sign-in", async () => {
    expect((await portal()).status).toBe(401);
  });

  it("fails when the user has no billing account yet", async () => {
    const cookie = await adminCookie();
    const res = await portal(cookie);
    expect(res.status).toBe(400);
    expect(customerSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns the customer portal url once a Polar customer exists", async () => {
    const cookie = await adminCookie();
    await db()
      .update(schema.user)
      .set({ polarCustomerId: "cus_123" })
      .where(eq(schema.user.id, "admin-1"));
    const res = await portal(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://sandbox.polar.sh/portal/test" });
    expect(customerSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_123" }),
    );
  });
});

describe("GET /api/user reports whether a billing account exists (#85)", () => {
  async function currentUser(cookie: string) {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://localhost/api/user", { headers: { cookie } }),
      polarEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return jsonBody<{
      user: {
        plan: string;
        hasBillingAccount: boolean;
        comped: boolean;
        polarSubscriptionCurrentPeriodEnd: number | null;
      };
    }>(res);
  }

  it("reports no period end at all for a user without a subscription", async () => {
    // Number(null) is 0, not NaN, so a helper that only guarded against NaN
    // handed every free account a subscription ending on 1 January 1970. The
    // billing page reads that date straight out, and the cancel notice shows
    // it to whoever is looking.
    const cookie = await adminCookie();

    expect((await currentUser(cookie)).user.polarSubscriptionCurrentPeriodEnd).toBeNull();
  });

  it("is false for a paid plan with no Polar customer, whose portal would error", async () => {
    const cookie = await adminCookie();
    await db()
      .update(schema.user)
      .set({ plan: "pro", subscriptionPlan: "pro", subscriptionStatus: "active" })
      .where(eq(schema.user.id, "admin-1"));

    const { user } = await currentUser(cookie);

    expect(user.plan).toBe("pro");
    expect(user.hasBillingAccount).toBe(false);
    // A subscription with no customer id is not a comp, and the page says so
    // rather than telling them their plan was granted by hand (#81).
    expect(user.comped).toBe(false);
    // The signal has to agree with the route it guards, or the button is
    // dead again.
    expect((await portal(cookie)).status).toBe(400);
  });

  it("tells a comp apart from a subscription with no customer", async () => {
    const cookie = await adminCookie();
    await db()
      .update(schema.user)
      .set({ plan: "pro", compPlan: "pro", compReason: "Design partner" })
      .where(eq(schema.user.id, "admin-1"));

    const { user } = await currentUser(cookie);

    expect(user.hasBillingAccount).toBe(false);
    expect(user.comped).toBe(true);
  });

  it("is true once a Polar customer exists", async () => {
    const cookie = await adminCookie();
    await db()
      .update(schema.user)
      .set({ plan: "pro", polarCustomerId: "cus_123" })
      .where(eq(schema.user.id, "admin-1"));

    expect((await currentUser(cookie)).user.hasBillingAccount).toBe(true);
    expect((await portal(cookie)).status).toBe(200);
  });

  it("is false on the free plan, which has no customer either", async () => {
    const cookie = await adminCookie();
    await db().update(schema.user).set({ plan: "free" }).where(eq(schema.user.id, "admin-1"));

    expect((await currentUser(cookie)).user.hasBillingAccount).toBe(false);
  });

  it("never exposes the Polar customer id itself", async () => {
    const cookie = await adminCookie();
    await db()
      .update(schema.user)
      .set({ polarCustomerId: "cus_secret" })
      .where(eq(schema.user.id, "admin-1"));

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("http://localhost/api/user", { headers: { cookie } }),
      polarEnv(),
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(await res.text()).not.toContain("cus_secret");
  });
});

describe("POST /api/webhooks/polar", () => {
  it("rejects a payload with an invalid signature", async () => {
    await seedUser();
    const res = await postWebhook(
      { type: "subscription.active", data: { id: "sub_1" } },
      { "webhook-id": "x", "webhook-timestamp": "0", "webhook-signature": "v1,bogus" },
    );
    expect(res.status).toBe(403);
    expect((await getUser()).plan).toBe("free");
  });

  it("subscription.active upgrades the user to the mapped plan", async () => {
    await seedUser();
    const res = await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_1",
        customer_id: "cus_1",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
      },
    });
    expect(res.status).toBe(200);
    const user = await getUser();
    expect(user.plan).toBe("pro");
    expect(user.polarCustomerId).toBe("cus_1");
    expect(user.polarSubscriptionId).toBe("sub_1");
    expect(user.polarSubscriptionCancelAtPeriodEnd).toBe(false);
  });

  it("subscription.active maps the hobby product to the hobby plan", async () => {
    await seedUser();
    await postWebhook({
      type: "subscription.active",
      data: { id: "sub_1", product_id: POLAR_HOBBY_PRODUCT_ID, metadata: { userId: "user-1" } },
    });
    expect((await getUser()).plan).toBe("hobby");
  });

  it("subscription.active is a no-op without a userId in metadata", async () => {
    await seedUser();
    await postWebhook({
      type: "subscription.active",
      data: { id: "sub_1", product_id: POLAR_PRO_PRODUCT_ID, metadata: {} },
    });
    expect((await getUser()).plan).toBe("free");
  });

  it("subscription.revoked drops the user back to free", async () => {
    await seedUser({ plan: "pro", polarSubscriptionId: "sub_1" });
    await postWebhook({
      type: "subscription.revoked",
      data: { id: "sub_1", metadata: { userId: "user-1" } },
    });
    const user = await getUser();
    expect(user.plan).toBe("free");
    expect(user.polarSubscriptionId).toBeNull();
  });

  it("subscription.revoked falls back to matching by subscription id when metadata is missing", async () => {
    await seedUser({ plan: "pro", polarSubscriptionId: "sub_1" });
    await postWebhook({ type: "subscription.revoked", data: { id: "sub_1" } });
    expect((await getUser()).plan).toBe("free");
  });

  it("subscription.canceled schedules cancellation at period end", async () => {
    await seedUser({ plan: "pro" });
    await postWebhook({
      type: "subscription.canceled",
      data: {
        id: "sub_1",
        metadata: { userId: "user-1" },
        current_period_end: "2026-01-01T00:00:00Z",
      },
    });
    const user = await getUser();
    expect(user.polarSubscriptionCancelAtPeriodEnd).toBe(true);
    expect(user.polarSubscriptionCurrentPeriodEnd?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("subscription.canceled falls back to ends_at when current_period_end is absent", async () => {
    await seedUser({ plan: "pro" });
    await postWebhook({
      type: "subscription.canceled",
      data: { id: "sub_1", metadata: { userId: "user-1" }, ends_at: "2026-02-01T00:00:00Z" },
    });
    expect((await getUser()).polarSubscriptionCurrentPeriodEnd?.toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });

  it("subscription.uncanceled clears a scheduled cancellation", async () => {
    await seedUser({
      plan: "pro",
      polarSubscriptionCancelAtPeriodEnd: true,
      polarSubscriptionCurrentPeriodEnd: new Date("2026-01-01"),
    });
    await postWebhook({
      type: "subscription.uncanceled",
      data: { id: "sub_1", metadata: { userId: "user-1" } },
    });
    const user = await getUser();
    expect(user.polarSubscriptionCancelAtPeriodEnd).toBe(false);
    expect(user.polarSubscriptionCurrentPeriodEnd).toBeNull();
  });

  // What each status does to access now lives in entitlement.worker.ts (#84);
  // this keeps the original pair, which is still the common case.
  it("subscription.updated grants the plan on an active status and not on a canceled one", async () => {
    await seedUser({ plan: "free" });
    await postWebhook({
      type: "subscription.updated",
      data: {
        id: "sub_1",
        status: "canceled",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
      },
    });
    expect((await getUser()).plan).toBe("free");

    await postWebhook({
      type: "subscription.updated",
      data: {
        id: "sub_1",
        status: "active",
        product_id: POLAR_HOBBY_PRODUCT_ID,
        metadata: { userId: "user-1" },
      },
    });
    expect((await getUser()).plan).toBe("hobby");
  });

  // The event that arrives first wins on freshness, and `subscription.active`
  // is not guaranteed to be it. If only that event carried the customer id,
  // the loser would take the id down with it and leave a paying user unable
  // to open the billing portal.
  it("subscription.updated stores the customer id, so the portal opens without an active event", async () => {
    await seedUser({ plan: "free", polarCustomerId: null });
    await postWebhook({
      type: "subscription.updated",
      data: {
        id: "sub_1",
        status: "active",
        customer_id: "cus_1",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
      },
    });
    const user = await getUser();
    expect(user.plan).toBe("pro");
    expect(user.polarCustomerId).toBe("cus_1");
  });

  it("a later snapshot without a customer id leaves the stored one alone", async () => {
    await seedUser({ plan: "free", polarCustomerId: "cus_1" });
    await postWebhook({
      type: "subscription.updated",
      data: {
        id: "sub_1",
        status: "active",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
      },
    });
    expect((await getUser()).polarCustomerId).toBe("cus_1");
  });

  it("ignores unrecognized event types without touching the user", async () => {
    await seedUser({ plan: "free" });
    const res = await postWebhook({ type: "checkout.updated", data: { id: "co_1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect((await getUser()).plan).toBe("free");
  });

  it("subscription.active never grants a plan for an unrecognized product id (#17)", async () => {
    await seedUser({ plan: "free" });
    const res = await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_1",
        customer_id: "cus_1",
        product_id: "prod_unknown_or_stale",
        metadata: { userId: "user-1" },
      },
    });
    expect(res.status).toBe(200);
    const user = await getUser();
    expect(user.plan).toBe("free");
    expect(user.polarSubscriptionId).toBeNull();
  });

  it("subscription.updated never grants a plan for an unrecognized product id (#17)", async () => {
    await seedUser({ plan: "free" });
    await postWebhook({
      type: "subscription.updated",
      data: {
        id: "sub_1",
        status: "active",
        product_id: "prod_unknown_or_stale",
        metadata: { userId: "user-1" },
      },
    });
    expect((await getUser()).plan).toBe("free");
  });

  it("redelivering the same event is a no-op, because applying it twice lands the same state (#17)", async () => {
    await seedUser({ plan: "free" });
    const payload = subscriptionActivePayload();
    const headers = signPayloadWithId(payload, "redelivered-1");

    expect((await postWebhook(JSON.parse(payload), headers)).status).toBe(200);
    const afterFirst = await getUser();
    expect(afterFirst.plan).toBe("pro");

    const redelivered = await postWebhook(JSON.parse(payload), headers);
    expect(redelivered.status).toBe(200);
    const afterSecond = await getUser();
    expect(afterSecond.plan).toBe("pro");
    expect(afterSecond.polarSubscriptionId).toBe(afterFirst.polarSubscriptionId);
    expect(afterSecond.polarSubscriptionCancelAtPeriodEnd).toBe(
      afterFirst.polarSubscriptionCancelAtPeriodEnd,
    );
  });

  it("a late subscription.revoked cannot downgrade a user a newer event already upgraded (#17)", async () => {
    await seedUser({ plan: "free" });

    // The revoke happened first at Polar, the activation after it. Delivery
    // arrives in the opposite order, which Polar explicitly does not
    // guarantee against: the stale revoke must not win.
    await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_2",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
        modified_at: "2026-03-02T00:00:00Z",
      },
    });
    expect((await getUser()).plan).toBe("pro");

    const stale = await postWebhook({
      type: "subscription.revoked",
      data: {
        id: "sub_1",
        metadata: { userId: "user-1" },
        modified_at: "2026-03-01T00:00:00Z",
      },
    });

    // 200, not an error: nothing is wrong, the event is simply obsolete.
    // A non-2xx would earn a retry, and ten in a row disable the endpoint.
    expect(stale.status).toBe(200);
    const user = await getUser();
    expect(user.plan).toBe("pro");
    expect(user.polarSubscriptionId).toBe("sub_2");
  });

  it("a newer event still applies over an older one (#17)", async () => {
    await seedUser({ plan: "free" });

    await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_1",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
        modified_at: "2026-03-01T00:00:00Z",
      },
    });
    expect((await getUser()).plan).toBe("pro");

    await postWebhook({
      type: "subscription.revoked",
      data: {
        id: "sub_1",
        metadata: { userId: "user-1" },
        modified_at: "2026-03-02T00:00:00Z",
      },
    });
    expect((await getUser()).plan).toBe("free");
  });

  it("applies both of two sibling events that share a modified_at (#17)", async () => {
    await seedUser({ plan: "free" });
    const at = "2026-03-01T00:00:00Z";

    await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_1",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
        modified_at: at,
      },
    });
    // Same timestamp, different event: a strict `<` guard would silently
    // drop this one and lose the scheduled cancellation.
    await postWebhook({
      type: "subscription.canceled",
      data: {
        id: "sub_1",
        metadata: { userId: "user-1" },
        current_period_end: "2026-04-01T00:00:00Z",
        modified_at: at,
      },
    });

    const user = await getUser();
    expect(user.plan).toBe("pro");
    expect(user.polarSubscriptionCancelAtPeriodEnd).toBe(true);
  });

  it("alerts when an event names a user we hold no row for (#17)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    const alerting = overrideEnv({
      BETTER_AUTH_SECRET: "test-secret",
      POLAR_WEBHOOK_SECRET,
      POLAR_HOBBY_PRODUCT_ID,
      POLAR_PRO_PRODUCT_ID,
      BETTERSTACK_SOURCE_TOKEN: "tok_test",
      BETTERSTACK_INGEST_URL: "https://in.logs.betterstack.example",
    });

    // No seeded user: the checkout metadata points at nobody, so the plan
    // this event paid for lands on no one. Silent 200 is still the right
    // answer to Polar, but it must not be silent to us.
    const res = await postWebhook(
      {
        type: "subscription.active",
        data: {
          id: "sub_ghost",
          product_id: POLAR_PRO_PRODUCT_ID,
          metadata: { userId: "user-does-not-exist" },
        },
      },
      undefined,
      alerting,
    );

    expect(res.status).toBe(200);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body).toEqual([
      {
        event: "polar_webhook_no_matching_user",
        type: "subscription.active",
        subscriptionId: "sub_ghost",
        userId: "user-does-not-exist",
      },
    ]);
    fetchSpy.mockRestore();
  });

  it("does not alert when a real user's event is merely stale (#17)", async () => {
    await seedUser({ plan: "free" });
    const alerting = overrideEnv({
      BETTER_AUTH_SECRET: "test-secret",
      POLAR_WEBHOOK_SECRET,
      POLAR_HOBBY_PRODUCT_ID,
      POLAR_PRO_PRODUCT_ID,
      BETTERSTACK_SOURCE_TOKEN: "tok_test",
      BETTERSTACK_INGEST_URL: "https://in.logs.betterstack.example",
    });
    await postWebhook(
      {
        type: "subscription.active",
        data: {
          id: "sub_1",
          product_id: POLAR_PRO_PRODUCT_ID,
          metadata: { userId: "user-1" },
          modified_at: "2026-03-02T00:00:00Z",
        },
      },
      undefined,
      alerting,
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    await postWebhook(
      {
        type: "subscription.revoked",
        data: {
          id: "sub_1",
          metadata: { userId: "user-1" },
          modified_at: "2026-03-01T00:00:00Z",
        },
      },
      undefined,
      alerting,
    );

    // The row exists and the guard did its job: nothing to report.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("falls back to created_at when modified_at is null (#17)", async () => {
    await seedUser({ plan: "free" });
    await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_1",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
        created_at: "2026-03-01T00:00:00Z",
        modified_at: null,
      },
    });
    expect((await getUser()).plan).toBe("pro");

    const stale = await postWebhook({
      type: "subscription.revoked",
      data: {
        id: "sub_1",
        metadata: { userId: "user-1" },
        created_at: "2026-02-01T00:00:00Z",
        modified_at: null,
      },
    });
    expect(stale.status).toBe(200);
    expect((await getUser()).plan).toBe("pro");
  });
});
