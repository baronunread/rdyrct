import { createPolar, errors } from "@polar-sh/sdk/2026-04";
import { createError } from "evlog";
import type { JsonValue } from "../shared/types";
import type { Env } from "./env";
import { captureAlert } from "./sentry";

/**
 * The calls the billing routes and account deletion make against Polar.
 *
 * Written out here so a test can hand the routes a stand-in through `BILLING`
 * on the env, the same way it hands them a queue or a rate limiter, instead of
 * replacing the SDK module underneath them. The real `Polar` client satisfies
 * this, so production passes the genuine article and nothing is mocked.
 */
export interface BillingProvider {
  checkouts: {
    create(options: {
      products: string[];
      success_url: string;
      customer_email: string;
      metadata: { userId: string };
    }): Promise<{ url: string }>;
    /** Used by the checkout-confirm fallback (POST /checkout/:id/confirm):
     * asks Polar directly whether a checkout succeeded, for when its webhook
     * never lands. */
    get(id: string): Promise<{
      status: string;
      product_id: string | null;
      customer_id: string | null;
      metadata: Record<string, JsonValue>;
    }>;
  };
  customerSessions: {
    create(options: { customer_id: string }): Promise<{ customer_portal_url: string }>;
  };
  subscriptions: {
    /** Ends a subscription now, with no further charge. */
    revoke(id: string): Promise<{ id: string }>;
  };
}

export const polarFor = (env: Env): BillingProvider =>
  env.BILLING ??
  createPolar({
    // Unset only when billing is off, and every caller checks that first.
    accessToken: env.POLAR_ACCESS_TOKEN ?? "",
    environment: env.POLAR_SERVER ?? "sandbox",
  });

/**
 * Ends an account's Polar subscription before the account is deleted (#337).
 *
 * Webhooks find a user by checkout metadata or by subscription id, so once
 * the row is gone nothing here can stop the charges. A subscription Polar no
 * longer has, or has already revoked, needs nothing more. Any other failure
 * throws before anything is deleted, so the person can try again with their
 * account and their subscription both intact.
 */
export async function revokeSubscriptionOf(env: Env, userId: string): Promise<void> {
  if (!env.POLAR_ACCESS_TOKEN && !env.BILLING) return;
  const row = await env.DB.prepare(
    "select polar_subscription_id as subscriptionId from user where id = ?",
  )
    .bind(userId)
    .first<{ subscriptionId: string | null }>();
  const subscriptionId = row?.subscriptionId;
  if (!subscriptionId) return;
  try {
    await polarFor(env).subscriptions.revoke(subscriptionId);
  } catch (error) {
    if (
      error instanceof errors.ResourceNotFound ||
      error instanceof errors.AlreadyCanceledSubscription
    )
      return;
    captureAlert([{ event: "billing_revoke_failed", userId, subscriptionId }]);
    throw createError({
      status: 502,
      message: "Could not cancel the subscription, so the account is still here.",
      why: "Polar did not confirm the cancellation, and a deleted account would keep paying.",
      fix: "Try again in a few minutes.",
      cause: error instanceof Error ? error : undefined,
    });
  }
}
