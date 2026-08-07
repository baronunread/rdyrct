import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { Polar } from "@polar-sh/sdk";
import { Webhook } from "standardwebhooks";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, Env } from "../env";
import { requireUser } from "../guards";
import { alertBetterStack } from "../alerts";
import { effectivePlanSql } from "../entitlement";
import { jsonBodyLimit } from "../body-limit";

const polarFor = (env: Env) =>
  new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER ?? "sandbox",
  });

// Mounted at /api/billing: the caller's own subscription (per-user billing).
// (The Polar webhook itself is mounted separately, outside this router and
// its body limit — see handlePolarWebhook below and index.ts.)
export const billingRoutes = new Hono<AppEnv>();
billingRoutes.use("*", jsonBodyLimit());

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
    // What this subscription actually charges, in the currency's minor units,
    // as Polar reports it on the subscription itself (so a discounted
    // subscription reports the discounted amount). Revenue is computed from
    // these rather than from list-price constants (#82).
    amount?: number | null;
    currency?: string | null;
    recurring_interval?: string | null;
    // How fresh this snapshot is. `modified_at` is null until the
    // subscription's first change, so `created_at` is the fallback; both are
    // on every Polar object (see @polar-sh/sdk's Subscription model).
    created_at?: string;
    modified_at?: string | null;
  };
}

type Db = ReturnType<typeof drizzle>;

/**
 * When the state an event describes was set at Polar. Events without either
 * timestamp sort as epoch 0, so they can only ever write over a row that has
 * never been touched by a webhook.
 */
function eventAt(event: PolarEvent): Date {
  const raw = event.data.modified_at ?? event.data.created_at;
  const parsed = raw ? Date.parse(raw) : NaN;
  return new Date(Number.isNaN(parsed) ? 0 : parsed);
}

/**
 * Refuses to write over state a *newer* Polar event already wrote.
 *
 * Polar delivers at-least-once with no ordering guarantee, so a delayed
 * `subscription.revoked` can land after the `subscription.active` that
 * replaced it and downgrade a paying customer. Pairing every mutation's own
 * WHERE with this one makes that stale write match no row.
 *
 * There is deliberately no delivery-id ledger. Each mutation below is a
 * blind `UPDATE ... SET`, so applying one twice leaves the same row as
 * applying it once — duplicate deliveries need no defence, only out-of-order
 * ones do. `<=` follows from that: a repeat is harmless, while a strict `<`
 * would drop the second of two sibling events that share a `modified_at`
 * (Polar can emit `subscription.canceled` and `subscription.updated` from a
 * single change).
 */
function notStale(at: Date) {
  return or(isNull(schema.user.polarEventAt), lte(schema.user.polarEventAt, at));
}

/**
 * Each of these applies one event's entitlement change, guarded by
 * `notStale`. `null` means "nothing to write" (e.g. no userId in metadata).
 */

/** Which user an event addresses: its checkout metadata, or the subscription
 * id we already stored for them.
 *
 * One row holds one subscription, and it is whichever subscription changed
 * most recently: two concurrent subscriptions for one person resolve through
 * `notStale`, so the later change wins and the earlier one cannot write back
 * over it (#84). Nothing here sums two subscriptions, and the product does
 * not sell a second one. */
function subjectOf(event: PolarEvent) {
  const userId = String(event.data.metadata?.userId ?? "");
  return userId ? eq(schema.user.id, userId) : eq(schema.user.polarSubscriptionId, event.data.id);
}

/**
 * The subscription facts an event carries, plus the `plan` they derive to.
 *
 * A webhook writes what Polar says and never touches `comp_*`: an admin's
 * comp outranks it, so `effectivePlanSql` reads the comp column off the row
 * and a revoked subscription cannot strip granted access (#81).
 */
function subscriptionFacts(event: PolarEvent, plan: "hobby" | "pro" | null, status: string) {
  return {
    subscriptionPlan: plan,
    subscriptionStatus: status,
    subscriptionAmount: event.data.amount ?? null,
    subscriptionCurrency: event.data.currency ?? null,
    subscriptionInterval: event.data.recurring_interval ?? null,
    plan: effectivePlanSql({ subscriptionPlan: plan, subscriptionStatus: status }),
  };
}

/** Alerts and declines to write when a product id maps to no plan. Fails
 * closed: an unrecognized product must never grant a plan (#17). */
async function planForProductOrAlert(env: Env, event: PolarEvent, userId: string | null) {
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
  }
  return plan;
}

async function subscriptionActiveMutation(db: Db, env: Env, event: PolarEvent) {
  const userId = String(event.data.metadata?.userId ?? "");
  if (!userId) return null;
  const plan = await planForProductOrAlert(env, event, userId);
  if (!plan) return null;
  const at = eventAt(event);
  return db
    .update(schema.user)
    .set({
      ...subscriptionFacts(event, plan, event.data.status ?? "active"),
      polarCustomerId: event.data.customer_id ?? null,
      polarSubscriptionId: event.data.id,
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
      polarEventAt: at,
    })
    .where(and(eq(schema.user.id, userId), notStale(at)));
}

function subscriptionRevokedMutation(db: Db, event: PolarEvent) {
  const at = eventAt(event);
  return db
    .update(schema.user)
    .set({
      // The subscription is over, so its facts go with it. A comped user
      // keeps their comp, and `effectivePlanSql` keeps returning it.
      ...subscriptionFacts(event, null, event.data.status ?? "canceled"),
      polarSubscriptionId: null,
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
      polarEventAt: at,
    })
    .where(and(subjectOf(event), notStale(at)));
}

function subscriptionCanceledMutation(db: Db, event: PolarEvent) {
  const userId = String(event.data.metadata?.userId ?? "");
  const periodEnd = event.data.current_period_end ?? event.data.ends_at;
  if (!userId && !event.data.id) return null;
  const at = eventAt(event);
  return db
    .update(schema.user)
    .set({
      polarSubscriptionCancelAtPeriodEnd: true,
      polarSubscriptionCurrentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
      polarEventAt: at,
    })
    .where(and(subjectOf(event), notStale(at)));
}

/**
 * `subscription.updated` is the complete subscription, not a plan signal
 * (#84). It used to apply only `plan`, and only while `status === "active"`,
 * so every transition *out* of active, every cancellation state, and every
 * period end that arrived through this event was discarded.
 *
 * It now writes the whole snapshot. Which statuses keep access is one
 * decision, made in `entitlement.ts` and applied through `effectivePlanSql`.
 */
async function subscriptionUpdatedMutation(db: Db, env: Env, event: PolarEvent) {
  const status = event.data.status;
  // Polar puts both on every subscription payload. Without them there is no
  // snapshot to apply, and guessing the missing half would write fiction.
  if (!status || !event.data.product_id) return null;
  const userId = String(event.data.metadata?.userId ?? "");
  const plan = await planForProductOrAlert(env, event, userId || null);
  if (!plan) return null;
  const at = eventAt(event);
  const periodEnd = event.data.current_period_end ?? event.data.ends_at;
  return db
    .update(schema.user)
    .set({
      ...subscriptionFacts(event, plan, status),
      polarSubscriptionCancelAtPeriodEnd: event.data.cancel_at_period_end ?? false,
      polarSubscriptionCurrentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
      polarEventAt: at,
    })
    .where(and(subjectOf(event), notStale(at)));
}

function subscriptionUncanceledMutation(db: Db, event: PolarEvent) {
  const userId = String(event.data.metadata?.userId ?? "");
  if (!userId && !event.data.id) return null;
  const at = eventAt(event);
  return db
    .update(schema.user)
    .set({
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
      polarEventAt: at,
    })
    .where(and(subjectOf(event), notStale(at)));
}

/** The mutation for a recognized event type, or null for an unrecognized
 * type (nothing to apply) or an event with nothing to write. */
async function mutationFor(db: Db, env: Env, event: PolarEvent) {
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

  // One guarded statement, no delivery ledger: see `notStale` for why
  // out-of-order deliveries are the case worth defending against and
  // duplicates are not. A stale event matches no row and changes nothing,
  // which is a success as far as Polar is concerned — anything other than a
  // 2xx here earns a retry, and ten consecutive non-2xx responses disable
  // the endpoint outright.
  const mutation = await mutationFor(db, env, event);
  if (mutation) {
    const result = await mutation;
    if (result.meta.changes === 0) await alertIfNoSuchSubject(db, env, event);
  }
  return Response.json({ received: true });
}

/**
 * A mutation that changed nothing is usually a stale delivery losing to
 * `notStale`, which is the system working. It means something else when the
 * event names a user or a subscription we hold no row for at all: a checkout
 * whose metadata never carried a usable userId, or a subscription that
 * outlived the account it belonged to. That silently costs someone the plan
 * they paid for, so it is worth a look even though the response stays 200.
 *
 * The extra read only happens on the zero-row path, which is the rare one.
 */
async function alertIfNoSuchSubject(db: Db, env: Env, event: PolarEvent): Promise<void> {
  const rows = await db.select({ id: schema.user.id }).from(schema.user).where(subjectOf(event));
  if (rows.length > 0) return;
  await alertBetterStack(env, [
    {
      event: "polar_webhook_no_matching_user",
      type: event.type,
      subscriptionId: event.data.id,
      userId: String(event.data.metadata?.userId ?? "") || null,
    },
  ]);
}
