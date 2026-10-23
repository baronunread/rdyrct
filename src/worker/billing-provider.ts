import type { JsonValue } from "../shared/types";

/**
 * The calls the billing routes make against Polar.
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
    /** Ends a subscription at once, with no further charge. Account deletion
     * calls it (#337); it needs the token's `subscriptions:write` scope. */
    revoke(id: string): Promise<{ id: string }>;
    /** A customer's live subscriptions, so deletion revokes the real ones
     * and not a stored id that may be a placeholder. */
    list(query: {
      customer_id: string;
      active: boolean;
      limit: number;
    }): Promise<{ items: { id: string }[] }>;
  };
}
