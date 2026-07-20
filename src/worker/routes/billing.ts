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

billingRoutes.post("/checkout", requireUser, async (c) => {
  const user = c.var.user!;
  const checkout = await polarFor(c.env).checkouts.create({
    products: [c.env.POLAR_PRO_PRODUCT_ID],
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
    metadata?: Record<string, unknown>;
    cancel_at_period_end?: boolean;
    current_period_end?: string;
    ends_at?: string | null;
  };
}

export async function handlePolarWebhook(
  req: Request,
  env: Env,
): Promise<Response> {
  const body = await req.text();
  // standardwebhooks directly (what Polar signs with): the SDK's validateEvent
  // also zod-parses every payload shape, which we don't need for two events.
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
  if (event.type === "subscription.active") {
    const userId = String(event.data.metadata?.userId ?? "");
    if (userId) {
      await db
        .update(schema.user)
        .set({
          plan: "pro",
          polarCustomerId: event.data.customer_id ?? null,
          polarSubscriptionId: event.data.id,
          polarSubscriptionCancelAtPeriodEnd: false,
          polarSubscriptionCurrentPeriodEnd: null,
        })
        .where(eq(schema.user.id, userId));
    }
  } else if (event.type === "subscription.revoked") {
    // Downgrade by metadata userId, falling back to the stored subscription id.
    // Every org this user owns reverts to free limits; existing over-cap links
    // keep redirecting, only new creation is gated.
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
  } else if (event.type === "subscription.canceled") {
    // User scheduled cancellation. Access continues until the paid period ends,
    // at which point Polar sends subscription.revoked. Record the pending
    // cancellation and the end date so the UI can show a clear message.
    const userId = String(event.data.metadata?.userId ?? "");
    const periodEnd = event.data.current_period_end ?? event.data.ends_at;
    if (userId || event.data.id) {
      await db
        .update(schema.user)
        .set({
          polarSubscriptionCancelAtPeriodEnd: true,
          polarSubscriptionCurrentPeriodEnd: periodEnd
            ? new Date(periodEnd)
            : null,
        })
        .where(
          userId
            ? eq(schema.user.id, userId)
            : eq(schema.user.polarSubscriptionId, event.data.id),
        );
    }
  } else if (event.type === "subscription.uncanceled") {
    // User undid the scheduled cancellation. The subscription is active again.
    const userId = String(event.data.metadata?.userId ?? "");
    if (userId || event.data.id) {
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
  }
  return Response.json({ received: true });
}
