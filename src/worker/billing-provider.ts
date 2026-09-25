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
      successUrl: string;
      customerEmail: string;
      metadata: { userId: string };
    }): Promise<{ url: string }>;
    /** Used by the checkout-confirm fallback (POST /checkout/:id/confirm):
     * asks Polar directly whether a checkout succeeded, for when its webhook
     * never lands. */
    get(options: { id: string }): Promise<{
      status: string;
      productId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      metadata: Record<string, JsonValue>;
    }>;
  };
  customerSessions: {
    create(options: { customerId: string }): Promise<{ customerPortalUrl: string }>;
  };
}
