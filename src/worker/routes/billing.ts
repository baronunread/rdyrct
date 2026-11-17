import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { Webhook } from "standardwebhooks";
import * as v from "valibot";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { createError } from "evlog";
import type { BillingDetails, JsonValue } from "../../shared/types";
import { billingDetails, invoicePdfUrl, NO_BILLING_DETAILS } from "../billing-details";
import { requireUser } from "../guards";
import { captureAlert } from "../sentry";
import { effectivePlanSql } from "../entitlement";
import { reconcileUser } from "../reconcile";
import { billingEnabled } from "../plan";
import { jsonBodyLimit } from "../body-limit";
import { planForProduct, polarFor, polarRefusal, type BillingProvider } from "../billing-provider";
import { logFailure } from "../log-failure";

const NOTHING_TO_REVOKE = new Set(["AlreadyCanceledSubscription", "ResourceNotFound"]);

// Without this a deleted account kept paying (#337). False when Polar could not be reached or refused:
// the caller must then keep the account, since deleting it anyway is the bug. Revoking also ends
// the paid plan at once, which is moot.
export async function endSubscriptionBeforeDelete(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "select polar_customer_id as customerId, polar_subscription_id as subscriptionId from user where id = ?",
  )
    .bind(userId)
    .first<{ customerId: string | null; subscriptionId: string | null }>();
  if (!row?.customerId && !row?.subscriptionId) return true;
  // Read off env, not billingEnabled(): that flag only holds once a request set it. No token means
  // no way to cancel, and deleting anyway is the bug (#337).
  if (!(env.POLAR_ACCESS_TOKEN || env.BILLING)) {
    captureAlert([{ event: "account_delete_billing_unconfigured", userId }]);
    return false;
  }
  try {
    const polar = await polarFor(env);
    // Ask Polar rather than trust the stored id: the checkout-confirm fallback stores
    // `pending:<checkout>` until the webhook brings the real one, and revoking that would answer
    // "not found" while the real subscription went on billing.
    const live = row.customerId
      ? (await polar.subscriptions.list({ customer_id: row.customerId, active: true, limit: 100 }))
          .items
      : [];
    const ids = new Set(live.map((subscription) => subscription.id));
    if (row.subscriptionId && !row.subscriptionId.startsWith("pending:")) {
      ids.add(row.subscriptionId);
    }
    await Promise.all([...ids].map((id) => revoke(polar, id)));
    return true;
  } catch (error) {
    captureAlert([{ event: "account_delete_subscription_revoke_failed", userId }]);
    logFailure("account_delete_subscription_revoke_failed", error, { userId });
    return false;
  }
}

async function revoke(polar: BillingProvider, id: string): Promise<void> {
  try {
    await polar.subscriptions.revoke(id);
  } catch (error) {
    // Matched on the refusal's name, not its status: see polarRefusal.
    if (!NOTHING_TO_REVOKE.has(polarRefusal(error) ?? "")) throw error;
  }
}

// The Polar webhook is mounted separately, outside this router and its body limit (index.ts).
export const billingRoutes = new Hono<AppEnv>();
billingRoutes.use("*", jsonBodyLimit());

async function polarCustomerOf(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ customerId: schema.user.polarCustomerId })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return rows[0]?.customerId ?? null;
}

// Registered before the gate below: a copy that sells nothing has a true answer here (nothing).
// On a Polar failure it answers 502 and the page keeps its portal buttons.
billingRoutes.get("/details", requireUser, async (c) => {
  const log = c.get("log");
  const user = c.var.user!;
  log.set({ userId: user.id });
  const customerId = billingEnabled() ? await polarCustomerOf(c.var.db, user.id) : null;
  if (!customerId) return c.json(NO_BILLING_DETAILS);
  let details: BillingDetails;
  try {
    details = await billingDetails(await polarFor(c.env), c.env, customerId);
  } catch (cause) {
    throw createError({
      status: 502,
      message: "Could not load the card and invoices from Polar",
      why: `Polar refused or did not answer (${polarRefusal(cause) ?? "no refusal name"}).`,
      fix: "The subscription portal shows both. If this persists, check the Polar token can still create customer sessions.",
      cause: cause instanceof Error ? cause : undefined,
    });
  }
  log.set({ billing: { card: details.card !== null, invoices: details.invoices.length } });
  c.header("cache-control", "private, max-age=60");
  return c.json(details);
});

billingRoutes.use("*", async (c, next) => {
  if (!billingEnabled()) throw new HTTPException(404, { message: "Billing is not enabled" });
  await next();
});

// Anybody else's order id is a 404: the lookup runs as the user's own Polar customer. A GET that can
// make Polar generate the invoice, which /portal below warns against; here the page uses a plain
// anchor (nothing prefetches one) and generating an already-paid invoice changes nothing.
billingRoutes.get("/invoices/:orderId", requireUser, async (c) => {
  const log = c.get("log");
  const user = c.var.user!;
  const orderId = c.req.param("orderId");
  log.set({ userId: user.id, billing: { orderId } });
  const customerId = await polarCustomerOf(c.var.db, user.id);
  if (!customerId) throw new HTTPException(404, { message: "No such invoice" });
  let url: string | null;
  try {
    url = await invoicePdfUrl(await polarFor(c.env), customerId, orderId);
  } catch (cause) {
    throw createError({
      status: 502,
      message:
        "Polar could not produce this invoice. Try again in a minute, or open it from the subscription portal.",
      why: `Polar refused or did not answer (${polarRefusal(cause) ?? "no refusal name"}).`,
      fix: "Try again shortly; a new invoice takes Polar a few seconds to generate.",
      cause: cause instanceof Error ? cause : undefined,
    });
  }
  if (!url) throw new HTTPException(404, { message: "No such invoice" });
  return c.redirect(url, 302);
});

/** Yearly is a separate product priced 10% below twelve months. */
function productIdFor(
  env: Env,
  plan: "hobby" | "pro",
  interval: "month" | "year",
): string | undefined {
  if (plan === "hobby")
    return interval === "year" ? env.POLAR_HOBBY_YEARLY_PRODUCT_ID : env.POLAR_HOBBY_PRODUCT_ID;
  return interval === "year" ? env.POLAR_PRO_YEARLY_PRODUCT_ID : env.POLAR_PRO_PRODUCT_ID;
}

interface CheckoutBody {
  plan?: string;
  interval?: string;
  /** "welcome": both ways out of Polar land on /welcome, whether they paid or went back. */
  from?: string;
}

function checkoutReturn(
  appUrl: string,
  from: "welcome" | "billing",
  plan: string,
  interval: string,
) {
  if (from === "billing") return { success_url: `${appUrl}/billing?checkout_id={CHECKOUT_ID}` };
  const intent = `plan=${plan}&interval=${interval}`;
  return {
    success_url: `${appUrl}/welcome?checkout_id={CHECKOUT_ID}&${intent}`,
    return_url: `${appUrl}/welcome?checkout=cancelled&${intent}`,
  };
}

function checkoutField<T extends string>(
  value: string | undefined,
  choices: readonly [T, T],
  name: string,
): T {
  const picked = value ?? choices[0];
  const known = choices.find((choice) => choice === picked);
  if (!known) throw new HTTPException(400, { message: `${name} must be ${choices.join(" or ")}` });
  return known;
}

billingRoutes.post("/checkout", requireUser, async (c) => {
  const log = c.get("log");
  const user = c.var.user!;
  // SAFETY: an unparseable body stands in for an empty one, and `plan` is
  // optional, so reading it finds the same absence.
  const body = await c.req.json<CheckoutBody>().catch(() => ({}) as CheckoutBody);
  log.set({ userId: user.id, plan: body.plan, interval: body.interval, from: body.from });
  const plan = checkoutField(body.plan, ["pro", "hobby"], "plan");
  const interval = checkoutField(body.interval, ["month", "year"], "interval");
  const from = checkoutField(body.from, ["billing", "welcome"], "from");
  const productId = productIdFor(c.env, plan, interval);
  if (!productId) {
    throw new HTTPException(503, { message: `No Polar product is set for ${plan} (${interval})` });
  }
  const checkout = await (
    await polarFor(c.env)
  ).checkouts.create({
    products: [productId],
    // Polar interpolates {CHECKOUT_ID}; the SPA confirms the upgrade with it. The webhook is the
    // entitlement source; POST /checkout/:id/confirm below is the fallback.
    ...checkoutReturn(c.env.APP_URL, from, plan, interval),
    customer_email: user.email,
    metadata: { userId: user.id },
    allow_discount_codes: true,
  });
  log.audit({
    action: "billing.checkout",
    actor: { type: "user", id: user.id },
    target: { type: "checkout", id: user.id },
    outcome: "success",
  });
  return c.json({ url: checkout.url });
});

async function currentPlan(db: Db, userId: string) {
  const rows = await db
    .select({ plan: schema.user.plan })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return rows[0]?.plan ?? "free";
}

// Polar never backfills subscriptionId onto the checkout and reading the subscription needs scopes this
// integration lacks, so this grants on checkout status alone with a placeholder id the next webhook
// overwrites. It skips the write once the row shows the plan, or a racing poll would replace a real id.
async function confirmCheckoutPlan(
  env: Env,
  db: Db,
  userId: string,
  checkoutId: string,
  checkout: Pick<
    Awaited<ReturnType<BillingProvider["checkouts"]["get"]>>,
    "status" | "product_id" | "customer_id" | "metadata"
  >,
) {
  const before = await currentPlan(db, userId);
  const targetPlan = planForProduct(env, checkout.product_id ?? undefined);
  if (checkout.status !== "succeeded" || !targetPlan || before === targetPlan) return before;
  // A checkout stays "succeeded" forever, so alone it proves only that the user once paid. Grant only
  // while the customer still has a live subscription: replaying an old checkout would undo revocations.
  if (!(await paysFor(env, checkout.customer_id, targetPlan))) return before;
  await applyPolarEvent(env, db, {
    type: "subscription.active",
    data: {
      id: `pending:${checkoutId}`,
      customer_id: checkout.customer_id ?? undefined,
      product_id: checkout.product_id ?? undefined,
      status: "active",
      metadata: checkout.metadata,
      // "Now": a later webhook redelivery carrying the real, earlier created_at loses under notStale,
      // which is correct: this row already reflects it.
      modified_at: new Date().toISOString(),
    },
  });
  return currentPlan(db, userId);
}

async function paysFor(
  env: Env,
  customerId: string | null,
  plan: "hobby" | "pro",
): Promise<boolean> {
  if (!customerId) return false;
  const { items } = await (
    await polarFor(env)
  ).subscriptions.list({ customer_id: customerId, active: true, limit: 100 });
  return items.some((sub) => planForProduct(env, sub.product_id) === plan);
}

// Fallback for when the webhook has not landed by the time the client's poll gives up. Idempotent
// with a later webhook: both funnel into applyPolarEvent, guarded by notStale. POST, not GET, as for
// /portal below: this writes a plan onto the account.
billingRoutes.post("/checkout/:id/confirm", requireUser, async (c) => {
  const log = c.get("log");
  const user = c.var.user!;
  const checkoutId = c.req.param("id");
  const checkout = await (await polarFor(c.env)).checkouts.get(checkoutId);
  // SAFETY: only the checkout this account's own upgrade created may reconcile it: metadata.userId is
  // set server-side at creation and Polar does not let the client change it, so this rejects a
  // stranger's checkout id and a stale one from before an account switch.
  if (metadataUserId(checkout.metadata) !== user.id) {
    throw new HTTPException(404, { message: "Not found" });
  }
  log.set({ userId: user.id, checkoutId, checkoutStatus: checkout.status });
  const plan = await confirmCheckoutPlan(c.env, c.var.db, user.id, checkoutId, checkout);
  return c.json({ plan });
});

// POST, not GET: this creates a Polar customer session, and a GET that changes a third party is one
// prefetch away from doing it unasked.
billingRoutes.post("/portal", requireUser, async (c) => {
  const log = c.get("log");
  log.set({ userId: c.var.user!.id });
  const customerId = await polarCustomerOf(c.var.db, c.var.user!.id);
  if (!customerId) throw new HTTPException(400, { message: "No billing account yet" });
  const polar = await polarFor(c.env);
  // A refusal here is Polar's, not ours: say so, rather than a bare 500.
  try {
    const session = await polar.customerSessions.create({ customer_id: customerId });
    return c.json({ url: session.customer_portal_url });
  } catch (cause) {
    throw createError({
      status: 502,
      message: "Could not open the subscription portal",
      why: `Polar refused or did not answer (${polarRefusal(cause) ?? "no refusal name"}).`,
      fix: "Try again in a moment. If this persists, check the Polar token and that the customer id exists in this Polar environment.",
      cause: cause instanceof Error ? cause : undefined,
    });
  }
});

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
    // amount, currency and recurring_interval are not read on purpose: revenue is Polar's figure (#82).
    // `modified_at` is null until the subscription's first change, so `created_at` is the fallback.
    created_at?: string;
    modified_at?: string | null;
  };
}

type Db = DB;

function eventAt(event: PolarEvent): Date {
  const raw = event.data.modified_at ?? event.data.created_at;
  const parsed = raw ? Date.parse(raw) : NaN;
  return new Date(Number.isNaN(parsed) ? 0 : parsed);
}

// Polar delivers at-least-once and unordered: a delayed `subscription.revoked` can land after the
// `subscription.active` that replaced it. No delivery-id ledger: each mutation is a blind UPDATE, so
// duplicates are harmless. `<=` not `<`: Polar can emit two sibling events sharing a modified_at.
function notStale(at: Date) {
  return or(isNull(schema.user.polarEventAt), lte(schema.user.polarEventAt, at));
}

function metadataUserId(metadata: Record<string, JsonValue> | null | undefined): string {
  const parsed = v.safeParse(v.string(), metadata?.userId);
  return parsed.success ? parsed.output : "";
}

// One row holds one subscription, the most recently changed: concurrent ones resolve through
// notStale (#84).
function subjectOf(event: PolarEvent) {
  const userId = metadataUserId(event.data.metadata);
  return userId ? eq(schema.user.id, userId) : eq(schema.user.polarSubscriptionId, event.data.id);
}

// Never touches `comp_*`: an admin's comp outranks it via effectivePlanSql (#81).
// The customer id is written only when present, so a snapshot that omits it cannot erase the one on the row.
function customerIdOf(event: PolarEvent): { polarCustomerId?: string } {
  return event.data.customer_id ? { polarCustomerId: event.data.customer_id } : {};
}

function intervalForProduct(env: Env, productId: string | undefined): "month" | "year" | null {
  if (!productId) return null;
  if (productId === env.POLAR_HOBBY_YEARLY_PRODUCT_ID) return "year";
  if (productId === env.POLAR_PRO_YEARLY_PRODUCT_ID) return "year";
  return "month";
}

function subscriptionFacts(
  plan: "hobby" | "pro" | null,
  status: string,
  interval: "month" | "year" | null,
) {
  return {
    polarSubscriptionInterval: interval,
    subscriptionPlan: plan,
    subscriptionStatus: status,
    plan: effectivePlanSql({ subscriptionPlan: plan, subscriptionStatus: status }),
  };
}

/** Fails closed: an unrecognized product must never grant a plan (#17). */
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
  const userId = metadataUserId(event.data.metadata);
  if (!userId) return null;
  const plan = await planForProductOrAlert(env, event, userId);
  if (!plan) return null;
  const at = eventAt(event);
  return db
    .update(schema.user)
    .set({
      ...subscriptionFacts(
        plan,
        event.data.status ?? "active",
        intervalForProduct(env, event.data.product_id),
      ),
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
      // The subscription is over, so its facts go with it. A comp stays.
      ...subscriptionFacts(null, event.data.status ?? "canceled", null),
      polarSubscriptionId: null,
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
      polarEventAt: at,
    })
    .where(and(subjectOf(event), notStale(at)));
}

function subscriptionCanceledMutation(db: Db, event: PolarEvent) {
  const userId = metadataUserId(event.data.metadata);
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

// The complete subscription, not a plan signal (#84): every status transition is written. Which
// statuses keep access is decided in entitlement.ts.
async function subscriptionUpdatedMutation(db: Db, env: Env, event: PolarEvent) {
  const status = event.data.status;
  // Without both there is no snapshot to apply, and guessing the missing half would write fiction.
  if (!status || !event.data.product_id) return null;
  const userId = metadataUserId(event.data.metadata);
  const plan = await planForProductOrAlert(env, event, userId || null);
  if (!plan) return null;
  const at = eventAt(event);
  const periodEnd = event.data.current_period_end ?? event.data.ends_at;
  return db
    .update(schema.user)
    .set({
      ...subscriptionFacts(plan, status, intervalForProduct(env, event.data.product_id)),
      // Identity moves with the facts: the row holds the most recently changed subscription, so keeping
      // the old id beside another subscription's plan would describe one that does not exist.
      polarSubscriptionId: event.data.id,
      ...customerIdOf(event),
      polarSubscriptionCancelAtPeriodEnd: event.data.cancel_at_period_end ?? false,
      polarSubscriptionCurrentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
      polarEventAt: at,
    })
    .where(and(subjectOf(event), notStale(at)));
}

function subscriptionUncanceledMutation(db: Db, event: PolarEvent) {
  const userId = metadataUserId(event.data.metadata);
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

// Polar has two ways to turn a webhook secret into a signing key and both look like `whsec_…`:
// secrets before 8 September 2026 are Polar HMAC (key is the base64-encoded string), later ones
// Standard Webhooks (as is). Both are tried; either key comes from the same secret.
function verifiesWith(key: string, body: string, headers: Record<string, string>): boolean {
  try {
    new Webhook(key).verify(body, headers);
    return true;
  } catch {
    // A secret that is not valid base64 as given throws: that only means this is not the key.
    return false;
  }
}

// Read the subject before the mutation: `subscription.revoked` clears polar_subscription_id, the only
// thing `subjectOf` has for an event with no metadata.userId. Resolving afterwards locked and demoted
// no org (#158). A stale event matches no row and changes nothing.
async function applyPolarEvent(env: Env, db: Db, event: PolarEvent): Promise<void> {
  const subjectId = PLAN_EVENTS.has(event.type) ? await subjectIdOf(db, event) : null;
  const result = await mutationFor(db, env, event);
  if (!result) return;
  if (result.meta.changes === 0) await alertIfNoSuchSubject(db, event);
  // `reconcileUser` swallows its own failures: a webhook that 500s earns a
  // retry, and ten of those disable the endpoint.
  else if (subjectId) await reconcileUser(env, db, subjectId);
}

/** Polar's events are a few KB: anything near this is not one of theirs, and is refused unbuffered. */
const WEBHOOK_BODY_LIMIT = 1024 * 1024;

// Counts what arrives, not Content-Length, which may be missing or wrong.
async function readCapped(req: Request, limit: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function handlePolarWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.POLAR_WEBHOOK_SECRET) return Response.json({ message: "Not found" }, { status: 404 });
  const body = await readCapped(req, WEBHOOK_BODY_LIMIT);
  if (body === null) return Response.json({ message: "Request body too large" }, { status: 413 });
  const headers = Object.fromEntries(req.headers.entries());
  const secret = env.POLAR_WEBHOOK_SECRET;
  if (!verifiesWith(btoa(secret), body, headers) && !verifiesWith(secret, body, headers)) {
    return Response.json({ message: "Invalid signature" }, { status: 403 });
  }
  // SAFETY: the webhook signature was verified above, so this body is one
  // Polar sent. Every field PolarEvent declares is optional except the type
  // and id, which the handlers below branch on before reading anything else.
  const event = JSON.parse(body) as PolarEvent;
  const db = drizzle(env.DB, { schema });
  // Anything but a 2xx earns a retry and ten in a row disable the endpoint, so applyPolarEvent's
  // failures propagate rather than being swallowed.
  await applyPolarEvent(env, db, event);
  return Response.json({ received: true });
}

// `subscription.canceled` and `.uncanceled` only flip period-end flags, so they cannot put an org over caps (#158).
const PLAN_EVENTS = new Set([
  "subscription.active",
  "subscription.revoked",
  "subscription.updated",
]);

async function subjectIdOf(db: Db, event: PolarEvent): Promise<string | null> {
  const rows = await db.select({ id: schema.user.id }).from(schema.user).where(subjectOf(event));
  return rows[0]?.id ?? null;
}

// A mutation that changed nothing is usually a stale delivery losing to notStale. It means something
// else when the event names a user or subscription we hold no row for: that silently costs someone
// the plan they paid for. The extra read only happens on this rare zero-row path.
async function alertIfNoSuchSubject(db: Db, event: PolarEvent): Promise<void> {
  const rows = await db.select({ id: schema.user.id }).from(schema.user).where(subjectOf(event));
  if (rows.length > 0) return;
  captureAlert([
    {
      event: "polar_webhook_no_matching_user",
      type: event.type,
      subscriptionId: event.data.id,
      userId: metadataUserId(event.data.metadata) || null,
    },
  ]);
}
