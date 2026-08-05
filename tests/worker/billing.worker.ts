import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Webhook } from "standardwebhooks";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import {
  applyTestMigrations,
  adminCookie,
  billingEnv,
  POLAR_HOBBY_PRODUCT_ID,
  POLAR_PRO_PRODUCT_ID,
  POLAR_WEBHOOK_SECRET,
} from "./support";

// The Polar SDK makes real HTTP calls and expects a large, version-specific
// response schema back; mocking the SDK class itself (rather than faking its
// wire format) keeps these tests about our own route logic.
const { checkoutsCreate, customerSessionsCreate } = vi.hoisted(() => ({
  checkoutsCreate: vi.fn(async () => ({ url: "https://sandbox.polar.sh/checkout/test" })),
  customerSessionsCreate: vi.fn(async () => ({
    customerPortalUrl: "https://sandbox.polar.sh/portal/test",
  })),
}));

vi.mock("@polar-sh/sdk", () => {
  class Polar {
    checkouts = { create: checkoutsCreate };
    customerSessions = { create: customerSessionsCreate };
  }
  return { Polar };
});

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

async function seedUser(overrides: Partial<typeof schema.user.$inferInsert> = {}) {
  await db()
    .insert(schema.user)
    .values({
      id: "user-1",
      name: "Test User",
      email: "user1@example.com",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...overrides,
    });
}

async function getUser() {
  const rows = await db().select().from(schema.user).where(eq(schema.user.id, "user-1"));
  return rows[0];
}

async function checkout(cookie: string, body: Record<string, unknown>): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/billing/checkout", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    billingEnv(),
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
    billingEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

let nextMsgId = 0;

/** Signs a Polar webhook payload the same way `standardwebhooks` verifies
 * it, so posting through the real handler round-trips correctly. Each call
 * gets its own delivery id, matching real Polar/Svix deliveries (never
 * reused across distinct events) and the webhook handler's own dedupe
 * ledger (see issue #17), which would otherwise treat two same-id-but-
 * different-payload calls as a conflicting duplicate. */
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

async function postWebhook(event: unknown, headers?: Record<string, string>): Promise<Response> {
  const payload = JSON.stringify(event);
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/webhooks/polar", {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? signPayload(payload)) },
      body: payload,
    }),
    billingEnv(),
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

  it("subscription.updated only applies the plan when the status is active", async () => {
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

  it("redelivering the same event id is a harmless no-op, not reapplied (#17)", async () => {
    await seedUser({ plan: "free" });
    const payload = JSON.stringify({
      type: "subscription.active",
      data: {
        id: "sub_1",
        customer_id: "cus_1",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
      },
    });
    const headers = signPayloadWithId(payload, "redelivered-1");

    const first = await postWebhook(JSON.parse(payload), headers);
    expect(first.status).toBe(200);
    expect((await getUser()).plan).toBe("pro");

    // Simulate the plan changing after the first delivery, then the exact
    // same delivery landing again: it must not re-apply subscription.active
    // and stomp the plan a downgrade webhook already set.
    await db().update(schema.user).set({ plan: "free" }).where(eq(schema.user.id, "user-1"));
    const redelivered = await postWebhook(JSON.parse(payload), headers);
    expect(redelivered.status).toBe(200);
    expect((await getUser()).plan).toBe("free");
  });

  it("rejects a redelivered id whose payload doesn't match what was recorded (#17)", async () => {
    await seedUser({ plan: "free" });
    const first = JSON.stringify({
      type: "subscription.active",
      data: {
        id: "sub_1",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
      },
    });
    const headers = signPayloadWithId(first, "conflict-1");
    expect((await postWebhook(JSON.parse(first), headers)).status).toBe(200);
    expect((await getUser()).plan).toBe("pro");

    // Same delivery id, different body: not a real retry, so it must be
    // rejected rather than silently ignored or applied.
    const conflicting = JSON.stringify({
      type: "subscription.revoked",
      data: { id: "sub_1", metadata: { userId: "user-1" } },
    });
    const conflictHeaders = {
      ...headers,
      "webhook-signature": new Webhook(btoa(POLAR_WEBHOOK_SECRET)).sign(
        "conflict-1",
        new Date(Number(headers["webhook-timestamp"]) * 1000),
        conflicting,
      ),
    };
    const res = await postWebhook(JSON.parse(conflicting), conflictHeaders);
    expect(res.status).toBe(409);
    expect((await getUser()).plan).toBe("pro");
  });
});
