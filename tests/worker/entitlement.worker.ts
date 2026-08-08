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
  POLAR_PRO_PRODUCT_ID,
  POLAR_HOBBY_PRODUCT_ID,
  POLAR_WEBHOOK_SECRET,
  seedBillingUser as seedUser,
} from "./support";

// The Polar SDK is never reached by these tests (no checkout, no portal), but
// importing the worker pulls it in, and its constructor wants a real token.
vi.mock("@polar-sh/sdk", () => {
  class Polar {
    checkouts = { create: vi.fn() };
    customerSessions = { create: vi.fn() };
  }
  return { Polar };
});

beforeEach(async () => {
  await applyTestMigrations();
});

afterEach(async () => {
  await reset();
});

const db = () => drizzle(env.DB, { schema });

async function getUser(id = "user-1") {
  const rows = await db().select().from(schema.user).where(eq(schema.user.id, id));
  return rows[0];
}

let nextMsgId = 0;

async function postWebhook(event: unknown): Promise<Response> {
  const payload = JSON.stringify(event);
  const msgId = `msg-${++nextMsgId}`;
  const timestamp = new Date();
  const signature = new Webhook(btoa(POLAR_WEBHOOK_SECRET)).sign(msgId, timestamp, payload);
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/webhooks/polar", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": msgId,
        "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
        "webhook-signature": signature,
      },
      body: payload,
    }),
    billingEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function adminFetch(cookie: string, path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init.headers },
    }),
    billingEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

const grantComp = (cookie: string, body: unknown, userId = "user-1") =>
  adminFetch(cookie, `/api/admin/users/${userId}/comp`, {
    method: "POST",
    body: JSON.stringify(body),
  });

const revokeComp = (cookie: string, userId = "user-1") =>
  adminFetch(cookie, `/api/admin/users/${userId}/comp`, { method: "DELETE" });

/** A live pro subscription, as `subscription.active` would have left it. */
const paying = {
  plan: "pro" as const,
  subscriptionPlan: "pro" as const,
  subscriptionStatus: "active",
  polarSubscriptionId: "sub_1",
};

describe("comps (#81)", () => {
  it("grants paid access and records who granted it and why", async () => {
    const cookie = await adminCookie();
    await seedUser();

    const res = await grantComp(cookie, { plan: "pro", reason: "Design partner" });
    expect(res.status).toBe(200);

    const user = await getUser();
    expect(user.plan).toBe("pro");
    expect(user.compPlan).toBe("pro");
    expect(user.compReason).toBe("Design partner");
    expect(user.compGrantedBy).toBe("admin-1");
    expect(user.compGrantedAt).not.toBeNull();
  });

  it("invents no subscription: a comp leaves every Polar column alone", async () => {
    const cookie = await adminCookie();
    await seedUser();
    await grantComp(cookie, { plan: "pro", reason: "Support goodwill" });

    const user = await getUser();
    expect(user.subscriptionPlan).toBeNull();
    expect(user.subscriptionStatus).toBeNull();
    expect(user.polarSubscriptionId).toBeNull();
  });

  it("refuses a comp with no reason", async () => {
    const cookie = await adminCookie();
    await seedUser();
    const res = await grantComp(cookie, { plan: "pro", reason: "   " });
    expect(res.status).toBe(400);
    expect((await getUser()).plan).toBe("free");
  });

  it("refuses a comp of the free plan", async () => {
    const cookie = await adminCookie();
    await seedUser();
    expect((await grantComp(cookie, { plan: "free", reason: "why" })).status).toBe(400);
  });

  it("404s for a user that does not exist", async () => {
    const cookie = await adminCookie();
    const res = await grantComp(cookie, { plan: "pro", reason: "why" }, "nobody");
    expect(res.status).toBe(404);
  });

  it("no longer lets the plan be written straight onto the user", async () => {
    const cookie = await adminCookie();
    await seedUser();
    const res = await adminFetch(cookie, "/api/admin/users/user-1", {
      method: "PATCH",
      body: JSON.stringify({ plan: "pro" }),
    });
    expect(res.status).toBe(400);
    expect((await getUser()).plan).toBe("free");
  });

  it("revoking a comp drops the user back to free when nothing is behind it", async () => {
    const cookie = await adminCookie();
    await seedUser();
    await grantComp(cookie, { plan: "pro", reason: "Trial run" });

    expect((await revokeComp(cookie)).status).toBe(200);
    const user = await getUser();
    expect(user.plan).toBe("free");
    expect(user.compPlan).toBeNull();
    expect(user.compReason).toBeNull();
    expect(user.compGrantedBy).toBeNull();
  });

  it("revoking a comp uncovers the subscription underneath it", async () => {
    const cookie = await adminCookie();
    await seedUser({ ...paying, subscriptionPlan: "hobby", plan: "hobby" });
    await grantComp(cookie, { plan: "pro", reason: "Upgrade while we debug" });
    expect((await getUser()).plan).toBe("pro");

    await revokeComp(cookie);
    expect((await getUser()).plan).toBe("hobby");
  });

  it("a revoked subscription cannot strip access an admin granted", async () => {
    // The whole point of #81: these two writes used to be the same column.
    const cookie = await adminCookie();
    await seedUser(paying);
    await grantComp(cookie, { plan: "pro", reason: "Comped after a support issue" });

    await postWebhook({
      type: "subscription.revoked",
      data: { id: "sub_1", metadata: { userId: "user-1" }, created_at: "2026-01-01T00:00:00Z" },
    });

    const user = await getUser();
    expect(user.plan).toBe("pro");
    expect(user.compPlan).toBe("pro");
    // The subscription really is gone; only the comp keeps the access.
    expect(user.subscriptionPlan).toBeNull();
    expect(user.polarSubscriptionId).toBeNull();
  });

  it("a comped user with no subscription is still comped after an unrelated event", async () => {
    const cookie = await adminCookie();
    await seedUser();
    await grantComp(cookie, { plan: "hobby", reason: "Friend of the house" });
    await postWebhook({ type: "checkout.updated", data: { id: "co_1" } });
    expect((await getUser()).plan).toBe("hobby");
  });
});

describe("subscription statuses (#84)", () => {
  const updated = (over: Record<string, unknown>) => ({
    type: "subscription.updated",
    data: {
      id: "sub_1",
      product_id: POLAR_PRO_PRODUCT_ID,
      metadata: { userId: "user-1" },
      created_at: "2026-02-01T00:00:00Z",
      ...over,
    },
  });

  it("past_due keeps access and is recorded", async () => {
    await seedUser(paying);
    await postWebhook(updated({ status: "past_due" }));

    const user = await getUser();
    expect(user.plan).toBe("pro");
    expect(user.subscriptionStatus).toBe("past_due");
  });

  it("unpaid takes access away", async () => {
    await seedUser(paying);
    await postWebhook(updated({ status: "unpaid" }));

    const user = await getUser();
    expect(user.plan).toBe("free");
    // The subscription is still on the row: it exists, it just entitles
    // nothing, which is what admin needs to be able to see.
    expect(user.subscriptionPlan).toBe("pro");
    expect(user.subscriptionStatus).toBe("unpaid");
  });

  it("a status nobody wrote a rule for grants nothing", async () => {
    await seedUser(paying);
    await postWebhook(updated({ status: "some_future_polar_status" }));
    expect((await getUser()).plan).toBe("free");
  });

  it("synchronizes the product, so a downgrade through updated applies", async () => {
    await seedUser(paying);
    await postWebhook(updated({ status: "active", product_id: POLAR_HOBBY_PRODUCT_ID }));

    const user = await getUser();
    expect(user.plan).toBe("hobby");
    expect(user.subscriptionPlan).toBe("hobby");
  });

  it("synchronizes cancellation state and period end (#84)", async () => {
    await seedUser(paying);
    await postWebhook(
      updated({
        status: "active",
        cancel_at_period_end: true,
        current_period_end: "2026-03-01T00:00:00Z",
      }),
    );

    const user = await getUser();
    expect(user.plan).toBe("pro");
    expect(user.polarSubscriptionCancelAtPeriodEnd).toBe(true);
    expect(user.polarSubscriptionCurrentPeriodEnd?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("stores no price: revenue is Polar's figure, not a copy of it (#82)", async () => {
    await seedUser();
    await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_1",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
        amount: 450,
        currency: "eur",
        recurring_interval: "month",
        created_at: "2026-02-01T00:00:00Z",
      },
    });

    // The event carried a price and the row has nowhere to put it, on purpose:
    // one number, in Polar, net of discounts, tax and refunds.
    const user = await getUser();
    expect(user).not.toHaveProperty("subscriptionAmount");
    expect(user.subscriptionPlan).toBe("pro");
    expect(user.plan).toBe("pro");
  });

  it("keeps the most recently changed subscription when a user has two", async () => {
    // One row holds one subscription: the later change wins, and the earlier
    // subscription cannot write back over it.
    await seedUser();
    await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_new",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
        created_at: "2026-02-02T00:00:00Z",
      },
    });
    await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_old",
        product_id: POLAR_HOBBY_PRODUCT_ID,
        metadata: { userId: "user-1" },
        created_at: "2026-02-01T00:00:00Z",
      },
    });

    const user = await getUser();
    expect(user.polarSubscriptionId).toBe("sub_new");
    expect(user.plan).toBe("pro");
  });

  it("an updated event moves the subscription id along with the facts", async () => {
    // Otherwise the row would describe a subscription that does not exist:
    // one subscription's plan, status and price under another one's id.
    await seedUser();
    await postWebhook({
      type: "subscription.active",
      data: {
        id: "sub_new",
        product_id: POLAR_PRO_PRODUCT_ID,
        metadata: { userId: "user-1" },
        created_at: "2026-02-01T00:00:00Z",
      },
    });
    await postWebhook(
      updated({
        id: "sub_other",
        product_id: POLAR_HOBBY_PRODUCT_ID,
        status: "active",
        modified_at: "2026-02-03T00:00:00Z",
      }),
    );

    const user = await getUser();
    expect(user.subscriptionPlan).toBe("hobby");
    expect(user.polarSubscriptionId).toBe("sub_other");
  });
});
