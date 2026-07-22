import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { Polar } from "@polar-sh/sdk";
import { Webhook } from "standardwebhooks";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, Env } from "../env";
import { requireUser } from "../auth";

const polarFor = (env: Env) =>
  new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER ?? "sandbox",
  });

// Mounted at /api/billing: the caller's own subscription (per-user billing).
export const billingRoutes = new Hono<AppEnv>();

/** Which plan a Polar product grants. Unknown products fall back to pro so a
 * paying customer is never left on free limits by a mapping mistake. */
const planForProduct = (
  env: Env,
  productId: string | undefined,
): "hobby" | "pro" =>
  productId === env.POLAR_HOBBY_PRODUCT_ID ? "hobby" : "pro";

billingRoutes.post("/checkout", requireUser, async (c) => {
  const user = c.var.user!;
  const body = await c.req
    .json<{ plan?: string }>()
    .catch(() => ({}) as { plan?: string });
  const plan = body.plan ?? "pro";
  if (plan !== "hobby" && plan !== "pro")
    throw new HTTPException(400, { message: "plan must be hobby or pro" });
  const checkout = await polarFor(c.env).checkouts.create({
    products: [
      plan === "hobby"
        ? c.env.POLAR_HOBBY_PRODUCT_ID
        : c.env.POLAR_PRO_PRODUCT_ID,
    ],
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
  if (!customerId)
    throw new HTTPException(400, { message: "No billing account yet" });
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

async function handleSubscriptionActive(
  db: ReturnType<typeof drizzle>,
  env: Env,
  event: PolarEvent,
) {
  const userId = String(event.data.metadata?.userId ?? "");
  if (!userId) return;
  await db
    .update(schema.user)
    .set({
      plan: planForProduct(env, event.data.product_id),
      polarCustomerId: event.data.customer_id ?? null,
      polarSubscriptionId: event.data.id,
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
    })
    .where(eq(schema.user.id, userId));
}

async function handleSubscriptionRevoked(
  db: ReturnType<typeof drizzle>,
  env: Env,
  event: PolarEvent,
) {
  const userId = String(event.data.metadata?.userId ?? "");
  await db
    .update(schema.user)
    .set({
      plan: "free",
      polarSubscriptionId: null,
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
    })
    .where(
      userId
        ? eq(schema.user.id, userId)
        : eq(schema.user.polarSubscriptionId, event.data.id),
    );
}

async function handleSubscriptionCanceled(
  db: ReturnType<typeof drizzle>,
  env: Env,
  event: PolarEvent,
) {
  const userId = String(event.data.metadata?.userId ?? "");
  const periodEnd = event.data.current_period_end ?? event.data.ends_at;
  if (!userId && !event.data.id) return;
  await db
    .update(schema.user)
    .set({
      polarSubscriptionCancelAtPeriodEnd: true,
      polarSubscriptionCurrentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
    })
    .where(
      userId
        ? eq(schema.user.id, userId)
        : eq(schema.user.polarSubscriptionId, event.data.id),
    );
}

async function handleSubscriptionUpdated(
  db: ReturnType<typeof drizzle>,
  env: Env,
  event: PolarEvent,
) {
  if (event.data.status !== "active" || !event.data.product_id) return;
  const userId = String(event.data.metadata?.userId ?? "");
  await db
    .update(schema.user)
    .set({ plan: planForProduct(env, event.data.product_id) })
    .where(
      userId
        ? eq(schema.user.id, userId)
        : eq(schema.user.polarSubscriptionId, event.data.id),
    );
}

async function handleSubscriptionUncanceled(
  db: ReturnType<typeof drizzle>,
  env: Env,
  event: PolarEvent,
) {
  const userId = String(event.data.metadata?.userId ?? "");
  if (!userId && !event.data.id) return;
  await db
    .update(schema.user)
    .set({
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
    })
    .where(
      userId
        ? eq(schema.user.id, userId)
        : eq(schema.user.polarSubscriptionId, event.data.id),
    );
}

export async function handlePolarWebhook(
  req: Request,
  env: Env,
): Promise<Response> {
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
  const handlers: Record<string, (db: ReturnType<typeof drizzle>, env: Env, event: PolarEvent) => Promise<void>> = {
    "subscription.active": handleSubscriptionActive,
    "subscription.revoked": handleSubscriptionRevoked,
    "subscription.canceled": handleSubscriptionCanceled,
    "subscription.updated": handleSubscriptionUpdated,
    "subscription.uncanceled": handleSubscriptionUncanceled,
  };
  const handler = handlers[event.type];
  if (handler) await handler(db, env, event);
  return Response.json({ received: true });
}
