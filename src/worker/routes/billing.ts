import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { Polar } from "@polar-sh/sdk";
import { Webhook } from "standardwebhooks";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import type { JsonValue } from "../../shared/types";
import { requireUser } from "../guards";
import { captureAlert } from "../sentry";
import { effectivePlanSql } from "../entitlement";
import { reconcileUser } from "../reconcile";
import { jsonBodyLimit } from "../body-limit";
import type { BillingProvider } from "../billing-provider";

const polarFor = (env: Env): BillingProvider =>
  env.BILLING ??
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
 * closed. Both the monthly and yearly product for a plan map to the same
 * plan. An unrecognized product id (a misconfigured env var, a new Polar
 * product nobody wired up, a stale id from a deleted product) must never
 * grant a plan by falling through to the highest tier — that's how a mapping
 * mistake used to hand out Pro for free (see issue #17).
 */
function planForProduct(env: Env, productId: string | undefined): "hobby" | "pro" | null {
  if (!productId) return null;
  if (productId === env.POLAR_HOBBY_PRODUCT_ID) return "hobby";
  if (productId === env.POLAR_PRO_PRODUCT_ID) return "pro";
  if (productId === env.POLAR_HOBBY_YEARLY_PRODUCT_ID) return "hobby";
  if (productId === env.POLAR_PRO_YEARLY_PRODUCT_ID) return "pro";
  return null;
}

/** The Polar product to check out for a plan at a billing interval. Yearly is
 * a separate product priced 10% below twelve months. */
function productIdFor(env: Env, plan: "hobby" | "pro", interval: "month" | "year"): string {
  if (plan === "hobby")
    return interval === "year" ? env.POLAR_HOBBY_YEARLY_PRODUCT_ID : env.POLAR_HOBBY_PRODUCT_ID;
  return interval === "year" ? env.POLAR_PRO_YEARLY_PRODUCT_ID : env.POLAR_PRO_PRODUCT_ID;
}

/** What the checkout route reads off its request body. */
interface CheckoutBody {
  plan?: string;
  interval?: string;
}

billingRoutes.post("/checkout", requireUser, async (c) => {
  const log = c.get("log");
  const user = c.var.user!;
  // SAFETY: an unparseable body stands in for an empty one, and `plan` is
  // optional, so reading it finds the same absence.
  const body = await c.req.json<CheckoutBody>().catch(() => ({}) as CheckoutBody);
  const plan = body.plan ?? "pro";
  const interval = body.interval ?? "month";
  log.set({ userId: user.id, plan, interval });
  if (plan !== "hobby" && plan !== "pro")
    throw new HTTPException(400, { message: "plan must be hobby or pro" });
  if (interval !== "month" && interval !== "year")
    throw new HTTPException(400, { message: "interval must be month or year" });
  const checkout = await polarFor(c.env).checkouts.create({
    products: [productIdFor(c.env, plan, interval)],
    // Polar interpolates {CHECKOUT_ID}; the SPA uses it to confirm the
    // upgrade before celebrating. The webhook is the primary entitlement
    // source; POST /checkout/:id/confirm below is the fallback for when it
    // never lands.
    successUrl: `${c.env.APP_URL}/billing?checkout_id={CHECKOUT_ID}`,
    customerEmail: user.email,
    metadata: { userId: user.id },
  });
  log.audit({
    action: "billing.checkout",
    actor: { type: "user", id: user.id },
    target: { type: "checkout", id: user.id },
    outcome: "success",
  });
  return c.json({ url: checkout.url });
});

/**
 * Fallback for when the webhook hasn't landed by the time the client's poll
 * gives up (see WEBHOOK_POLL_MS/WEBHOOK_POLL_TRIES in billing.tsx): asks
 * Polar directly whether the checkout succeeded and, if so, grants the plan
 * itself instead of leaving someone who already paid looking free on every
 * reload. Idempotent with a webhook that arrives later (or redelivers): both
 * paths funnel into `applyPolarEvent`, which is timestamp-guarded
 * (`notStale`), so whichever lands first stands and the other is a no-op.
 *
 * POST, not GET: same reasoning as /portal below, and this one actually
 * writes a plan onto the account, so a GET's cousin (a prefetch) is worse.
 */
billingRoutes.post("/checkout/:id/confirm", requireUser, async (c) => {
  const log = c.get("log");
  const user = c.var.user!;
  const checkoutId = c.req.param("id");
  const checkout = await polarFor(c.env).checkouts.get({ id: checkoutId });
  // SAFETY: only the checkout this account's own upgrade created may
  // reconcile this account. metadata.userId is set server-side at creation
  // (POST /checkout above) and Polar does not let the client change it, so
  // this rejects both a stranger's checkout id and a stale one from before
  // an account switch.
  if (String(checkout.metadata.userId ?? "") !== user.id) {
    throw new HTTPException(404, { message: "Not found" });
  }
  log.set({ userId: user.id, checkoutId, checkoutStatus: checkout.status });
  // `status` is all a checkouts:write/checkouts:read token can see:
  // Polar never backfills subscriptionId onto the checkout itself (verified
  // against the sandbox API, not just undocumented), and reading the order or
  // subscription that succeeding it created needs orders:read/
  // subscriptions:read, a scope this integration doesn't carry. Polar's own
  // guidance treats checkout status as the UX confirmation signal and the
  // webhook as the entitlement source of truth, so this grants the plan on
  // status alone and stands in a placeholder id: the real one arrives on
  // whichever webhook (redelivered or fresh) lands next, matched by
  // metadata.userId same as always, and overwrites it. Known gap: if that
  // webhook's own timestamp is older than "now" (a stale redelivery, not a
  // fresh event), notStale drops it entirely and the placeholder lingers
  // until a genuinely later event (a renewal, a plan change) corrects it.
  // Cosmetic: nothing reads polarSubscriptionId except the webhook's own
  // fallback subject match, and hasBillingAccount / the portal button key off
  // polarCustomerId, which this does set correctly.
  if (checkout.status === "succeeded") {
    await applyPolarEvent(c.env, c.var.db, {
      type: "subscription.active",
      data: {
        id: `pending:${checkoutId}`,
        customer_id: checkout.customerId ?? undefined,
        product_id: checkout.productId ?? undefined,
        status: "active",
        metadata: checkout.metadata,
        // "Now": the freshest fact we have. A later webhook redelivery
        // carrying the subscription's real (earlier) created_at loses to
        // this under notStale, which is correct: this row already reflects
        // it.
        modified_at: new Date().toISOString(),
      },
    });
  }
  const rows = await c.var.db
    .select({ plan: schema.user.plan })
    .from(schema.user)
    .where(eq(schema.user.id, user.id));
  return c.json({ plan: rows[0]?.plan ?? "free" });
});

// POST, not GET: this creates a Polar customer session. A GET that changes
// something on a third party is one prefetch away from doing it unasked.
billingRoutes.post("/portal", requireUser, async (c) => {
  const log = c.get("log");
  log.set({ userId: c.var.user!.id });
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
    metadata?: Record<string, JsonValue>;
    cancel_at_period_end?: boolean;
    current_period_end?: string;
    ends_at?: string | null;
    // Polar also sends amount, currency and recurring_interval. They are
    // deliberately not read: revenue is Polar's figure, in Polar's dashboard,
    // and a copy here would be a second number to keep true (#82).
    //
    // How fresh this snapshot is. `modified_at` is null until the
    // subscription's first change, so `created_at` is the fallback; both are
    // on every Polar object (see @polar-sh/sdk's Subscription model).
    created_at?: string;
    modified_at?: string | null;
  };
}

// The schema-bound client `handlePolarWebhook` builds; the mutations below
// and the reconciliation pass share it.
type Db = DB;

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
/**
 * The Polar customer id, when the payload carries one.
 *
 * Written only when it is there, so a snapshot that omits it cannot erase the
 * id already on the row. `subscription.updated` can land before an older
 * `subscription.active`, and then notStale drops the active event that would
 * have carried the id: the row would pay for a plan whose billing portal it
 * cannot open.
 */
function customerIdOf(event: PolarEvent): { polarCustomerId?: string } {
  return event.data.customer_id ? { polarCustomerId: event.data.customer_id } : {};
}

function subscriptionFacts(plan: "hobby" | "pro" | null, status: string) {
  return {
    subscriptionPlan: plan,
    subscriptionStatus: status,
    plan: effectivePlanSql({ subscriptionPlan: plan, subscriptionStatus: status }),
  };
}

/** Alerts and declines to write when a product id maps to no plan. Fails
 * closed: an unrecognized product must never grant a plan (#17). */
async function planForProductOrAlert(env: Env, event: PolarEvent, userId: string | null) {
  const plan = planForProduct(env, event.data.product_id);
  if (!plan) {
    captureAlert([
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
      ...subscriptionFacts(plan, event.data.status ?? "active"),
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
      ...subscriptionFacts(null, event.data.status ?? "canceled"),
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
      ...subscriptionFacts(plan, status),
      // Identity moves with the facts. The row holds one subscription, the
      // most recently changed one, so writing another subscription's plan,
      // status and price while leaving the old id in place would describe a
      // subscription that does not exist.
      polarSubscriptionId: event.data.id,
      ...customerIdOf(event),
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

/**
 * Applies one event's effect and, if it actually changed the plan, runs the
 * entitlement reconciliation pass (#158). Shared by the webhook handler and
 * the checkout-confirm fallback (POST /checkout/:id/confirm above), which
 * synthesizes a subscription.active event from a checkout when Polar's own
 * webhook never delivers one.
 *
 * One guarded statement, no delivery ledger: see `notStale` for why
 * out-of-order deliveries are the case worth defending against and
 * duplicates are not. A stale event matches no row and changes nothing.
 * Read the subject *before* the mutation, because `subscription.revoked`
 * clears `polar_subscription_id`, which is the only thing `subjectOf` has to
 * go on for an event that carries no metadata.userId. Resolving afterwards
 * matched no row, so the plan dropped to free and no org was ever locked or
 * demoted: exactly the case #158 exists for.
 */
async function applyPolarEvent(env: Env, db: Db, event: PolarEvent): Promise<void> {
  const subjectId = PLAN_EVENTS.has(event.type) ? await subjectIdOf(db, event) : null;
  const mutation = await mutationFor(db, env, event);
  if (!mutation) return;
  const result = await mutation;
  if (result.meta.changes === 0) await alertIfNoSuchSubject(db, event);
  // `reconcileUser` swallows its own failures: a webhook that 500s earns a
  // retry, and ten of those disable the endpoint.
  else if (subjectId) await reconcileUser(env, db, subjectId);
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
  // SAFETY: the webhook signature was verified above, so this body is one
  // Polar sent. Every field PolarEvent declares is optional except the type
  // and id, which the handlers below branch on before reading anything else.
  const event = JSON.parse(body) as PolarEvent;
  const db = drizzle(env.DB, { schema });
  // Anything other than a 2xx here earns a retry, and ten consecutive
  // non-2xx responses disable the endpoint outright, so applyPolarEvent's
  // own failures are left to propagate rather than swallowed here.
  await applyPolarEvent(env, db, event);
  return Response.json({ received: true });
}

/**
 * The events that can move `plan`, and so the ones that owe the user's orgs
 * a reconciliation pass (#158). `subscription.canceled` and
 * `subscription.uncanceled` only flip the period-end flags, so they cannot
 * put an org over its caps.
 */
const PLAN_EVENTS = new Set([
  "subscription.active",
  "subscription.revoked",
  "subscription.updated",
]);

/** Which user this event addresses, resolved against the row as it stands
 * now. Read before any mutation writes over the columns `subjectOf` matches
 * on (see handlePolarWebhook). */
async function subjectIdOf(db: Db, event: PolarEvent): Promise<string | null> {
  const rows = await db.select({ id: schema.user.id }).from(schema.user).where(subjectOf(event));
  return rows[0]?.id ?? null;
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
async function alertIfNoSuchSubject(db: Db, event: PolarEvent): Promise<void> {
  const rows = await db.select({ id: schema.user.id }).from(schema.user).where(subjectOf(event));
  if (rows.length > 0) return;
  captureAlert([
    {
      event: "polar_webhook_no_matching_user",
      type: event.type,
      subscriptionId: event.data.id,
      userId: String(event.data.metadata?.userId ?? "") || null,
    },
  ]);
}
