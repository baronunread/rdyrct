import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { Polar } from "@polar-sh/sdk";
import { Webhook } from "standardwebhooks";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, Env } from "../env";
import { requireUser } from "../guards";
import { alertBetterStack } from "../alerts";

const polarFor = (env: Env) =>
  new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER ?? "sandbox",
  });

// Mounted at /api/billing: the caller's own subscription (per-user billing).
export const billingRoutes = new Hono<AppEnv>();

/**
 * Which plan a Polar product grants: an explicit allowlist that fails
 * closed. An unrecognized product id (a misconfigured env var, a new Polar
 * product nobody wired up, a stale id from a deleted product) must never
 * grant a plan by falling through to the highest tier — that's how a mapping
 * mistake used to hand out Pro for free (see issue #17).
 */
function planForProduct(env: Env, productId: string | undefined): "hobby" | "pro" | null {
  if (!productId) return null;
  if (productId === env.POLAR_HOBBY_PRODUCT_ID) return "hobby";
  if (productId === env.POLAR_PRO_PRODUCT_ID) return "pro";
  return null;
}

billingRoutes.post("/checkout", requireUser, async (c) => {
  const user = c.var.user!;
  const body = await c.req.json<{ plan?: string }>().catch(() => ({}) as { plan?: string });
  const plan = body.plan ?? "pro";
  if (plan !== "hobby" && plan !== "pro")
    throw new HTTPException(400, { message: "plan must be hobby or pro" });
  const checkout = await polarFor(c.env).checkouts.create({
    products: [plan === "hobby" ? c.env.POLAR_HOBBY_PRODUCT_ID : c.env.POLAR_PRO_PRODUCT_ID],
    // Polar interpolates {CHECKOUT_ID}; the SPA uses it to confirm the
    // upgrade before celebrating (webhook is still the entitlement source).
    successUrl: `${c.env.APP_URL}/billing?checkout_id={CHECKOUT_ID}`,
    customerEmail: user.email,
    metadata: { userId: user.id },
  });
  return c.json({ url: checkout.url });
});

billingRoutes.get("/portal", requireUser, async (c) => {
  const rows = await c.var.db
    .select({ customerId: schema.user.polarCustomerId })
    .from(schema.user)
    .where(eq(schema.user.id, c.var.user!.id));
  const customerId = rows[0]?.customerId;
  if (!customerId) throw new HTTPException(400, { message: "No billing account yet" });
  const session = await polarFor(c.env).customerSessions.create({ customerId });
  return c.json({ url: session.customerPortalUrl });
});

/**
 * Polar webhook: mounted publicly at /api/webhooks/polar (no session).
 * Checkout metadata.userId propagates onto the subscription, which is how an
 * event finds its user.
 */
interface PolarEvent {
  type: string;
  data: {
    id: string;
    customer_id?: string;
    product_id?: string;
    status?: string;
    metadata?: Record<string, unknown>;
    cancel_at_period_end?: boolean;
    current_period_end?: string;
    ends_at?: string | null;
  };
}

type Db = ReturnType<typeof drizzle>;

/** A built-but-unexecuted statement: `db.update(...).toSQL()` output,
 * converted to a raw D1 prepared statement so it can share a batch (one
 * atomic transaction) with a statement from a differently-shaped Drizzle
 * query — Drizzle's own typed `.batch()` rejects a tuple of otherwise-valid
 * query builders whose `.set()` calls touch different columns. */
function toD1Statement(env: Env, query: { sql: string; params: unknown[] }) {
  return env.DB.prepare(query.sql).bind(...query.params);
}

/**
 * Each of these *builds* the entitlement mutation without executing it (no
 * `await`): the caller runs it in the same D1 batch as the webhook-delivery
 * ledger insert, so the two commit or fail together (see issue #17 review —
 * a mutation that failed after the ledger already committed used to make a
 * Polar retry of the same event a silent no-op instead of re-applying it).
 * `null` means "nothing to write" (e.g. no userId in metadata).
 */

async function subscriptionActiveMutation(db: Db, env: Env, event: PolarEvent) {
  const userId = String(event.data.metadata?.userId ?? "");
  if (!userId) return null;
  const plan = planForProduct(env, event.data.product_id);
  if (!plan) {
    await alertBetterStack(env, [
      {
        event: "polar_webhook_unknown_product",
        subscriptionId: event.data.id,
        productId: event.data.product_id ?? null,
        userId,
      },
    ]);
    return null;
  }
  return db
    .update(schema.user)
    .set({
      plan,
      polarCustomerId: event.data.customer_id ?? null,
      polarSubscriptionId: event.data.id,
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
    })
    .where(eq(schema.user.id, userId))
    .toSQL();
}

function subscriptionRevokedMutation(db: Db, event: PolarEvent) {
  const userId = String(event.data.metadata?.userId ?? "");
  return db
    .update(schema.user)
    .set({
      plan: "free",
      polarSubscriptionId: null,
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
    })
    .where(userId ? eq(schema.user.id, userId) : eq(schema.user.polarSubscriptionId, event.data.id))
    .toSQL();
}

function subscriptionCanceledMutation(db: Db, event: PolarEvent) {
  const userId = String(event.data.metadata?.userId ?? "");
  const periodEnd = event.data.current_period_end ?? event.data.ends_at;
  if (!userId && !event.data.id) return null;
  return db
    .update(schema.user)
    .set({
      polarSubscriptionCancelAtPeriodEnd: true,
      polarSubscriptionCurrentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
    })
    .where(userId ? eq(schema.user.id, userId) : eq(schema.user.polarSubscriptionId, event.data.id))
    .toSQL();
}

async function subscriptionUpdatedMutation(db: Db, env: Env, event: PolarEvent) {
  if (event.data.status !== "active" || !event.data.product_id) return null;
  const userId = String(event.data.metadata?.userId ?? "");
  const plan = planForProduct(env, event.data.product_id);
  if (!plan) {
    await alertBetterStack(env, [
      {
        event: "polar_webhook_unknown_product",
        subscriptionId: event.data.id,
        productId: event.data.product_id,
        userId: userId || null,
      },
    ]);
    return null;
  }
  return db
    .update(schema.user)
    .set({ plan })
    .where(userId ? eq(schema.user.id, userId) : eq(schema.user.polarSubscriptionId, event.data.id))
    .toSQL();
}

function subscriptionUncanceledMutation(db: Db, event: PolarEvent) {
  const userId = String(event.data.metadata?.userId ?? "");
  if (!userId && !event.data.id) return null;
  return db
    .update(schema.user)
    .set({
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
    })
    .where(userId ? eq(schema.user.id, userId) : eq(schema.user.polarSubscriptionId, event.data.id))
    .toSQL();
}

/** Builds the mutation for a recognized event type, or null for an
 * unrecognized type (nothing to apply) or an event with nothing to write. */
async function buildMutation(db: Db, env: Env, event: PolarEvent) {
  switch (event.type) {
    case "subscription.active":
      return subscriptionActiveMutation(db, env, event);
    case "subscription.revoked":
      return subscriptionRevokedMutation(db, event);
    case "subscription.canceled":
      return subscriptionCanceledMutation(db, event);
    case "subscription.updated":
      return subscriptionUpdatedMutation(db, env, event);
    case "subscription.uncanceled":
      return subscriptionUncanceledMutation(db, event);
    default:
      return null;
  }
}

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function handlePolarWebhook(req: Request, env: Env): Promise<Response> {
  const body = await req.text();
  try {
    new Webhook(btoa(env.POLAR_WEBHOOK_SECRET)).verify(
      body,
      Object.fromEntries(req.headers.entries()),
    );
  } catch {
    return Response.json({ message: "Invalid signature" }, { status: 403 });
  }
  const event = JSON.parse(body) as PolarEvent;
  const db = drizzle(env.DB, { schema });

  // The `webhook-id` header is Polar/Svix's per-delivery id: a durable
  // ledger of it closes the "duplicate delivery re-applies state" hole (see
  // issue #17). The ledger insert and the entitlement mutation run in the
  // *same* D1 batch (one atomic transaction): if the mutation fails, the
  // ledger insert rolls back with it, so a Polar retry of the same delivery
  // finds no ledger row and re-applies the event instead of silently
  // no-op'ing on an already-"processed" id.
  const deliveryId = req.headers.get("webhook-id");
  if (!deliveryId) {
    const mutation = await buildMutation(db, env, event);
    if (mutation) await toD1Statement(env, mutation).run();
    return Response.json({ received: true });
  }

  const payloadHash = await sha256Hex(body);
  const receivedAt = Date.now();
  const ledgerInsert = db
    .insert(schema.polarWebhookEvents)
    .values({ id: deliveryId, type: event.type, receivedAt, payloadHash })
    .onConflictDoNothing()
    .toSQL();
  const mutation = await buildMutation(db, env, event);
  const statements = [toD1Statement(env, ledgerInsert)];
  if (mutation) {
    // Gated on this exact insert having actually written the ledger row (not
    // just "a row with this id exists", which would also be true for an
    // already-processed duplicate): `received_at` is unique to this attempt,
    // so a conflicting duplicate's mutation becomes a no-op instead of
    // re-applying on every redelivery.
    statements.push(
      toD1Statement(env, {
        sql: `${mutation.sql} and exists (select 1 from polar_webhook_events where id = ? and received_at = ?)`,
        params: [...mutation.params, deliveryId, receivedAt],
      }),
    );
  }
  const results = await env.DB.batch(statements);

  if (results[0].meta.changes === 0) {
    const existing = await env.DB.prepare(
      "select payload_hash from polar_webhook_events where id = ?",
    )
      .bind(deliveryId)
      .first<{ payload_hash: string }>();
    // Same id, same payload: a harmless retry of a delivery already
    // applied. Same id, different payload: a genuine conflict, not a
    // retry, rejected rather than silently ignored or re-applied.
    if (existing?.payload_hash === payloadHash) return Response.json({ received: true });
    console.error("polar webhook: conflicting duplicate delivery id", deliveryId);
    return Response.json({ message: "Conflicting duplicate event id" }, { status: 409 });
  }
  return Response.json({ received: true });
}
