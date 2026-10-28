import type { JsonValue } from "../shared/types";
import * as v from "valibot";
import type { Env } from "./env";

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
    /** A customer session: the portal's URL, and the token the Customer
     * Portal API calls below act as that customer with. */
    create(options: {
      customer_id: string;
    }): Promise<{ customer_portal_url: string; token: string }>;
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
  /**
   * Polar's Customer Portal API, called with a customer session's token
   * (`AsCustomer`): the card and orders of that one customer, and nobody
   * else's. Used for the billing page's card and invoices because it needs
   * no scope beyond the `customer_sessions:write` the portal button already
   * has, where the organization's own orders and customers endpoints need
   * `orders:read` and `customers:read`.
   */
  customerPortal: {
    customers: {
      /** The customer, for which saved card is the default. */
      get(auth: AsCustomer): Promise<{ default_payment_method_id?: string | null }>;
      listPaymentMethods(
        query: { limit: number },
        auth: AsCustomer,
      ): Promise<{ items: PolarPaymentMethod[] }>;
    };
    orders: {
      /** Newest first: the billing page's invoice list. */
      list(
        query: { limit: number; sorting: "-created_at"[] },
        auth: AsCustomer,
      ): Promise<{ items: PolarOrder[] }>;
      /** One order; another customer's is a 404 (ResourceNotFound). */
      get(id: string, auth: AsCustomer): Promise<PolarOrder>;
      /** The invoice PDF's URL, once one has been generated (404 before). */
      invoice(id: string, auth: AsCustomer): Promise<{ url: string }>;
      /** Starts generating the invoice. Asynchronous: Polar answers 202 and
       * the PDF follows within seconds. */
      generateInvoice(id: string, auth: AsCustomer): Promise<void>;
      /** The receipt PDF's URL, for an order with a receipt number. */
      receipt(id: string, auth: AsCustomer): Promise<{ url: string }>;
    };
  };
}

/** The SDK's per-request token override: a customer session's token. */
export interface AsCustomer {
  accessToken: string;
}

/** The fields of a Polar order this app reads. */
export interface PolarOrder {
  id: string;
  created_at: string;
  status: "draft" | "pending" | "paid" | "refunded" | "partially_refunded" | "void";
  /** Cents, tax included. Negative for the credit a plan change leaves. */
  total_amount: number;
  currency: string;
  customer_id: string;
  product_id: string | null;
  is_invoice_generated: boolean;
  receipt_number: string | null;
}

/** A saved payment method. Only a `card` carries what the page shows. */
export type PolarPaymentMethod =
  | {
      id: string;
      type: "card";
      method_metadata: { brand: string; last4: string; exp_month: number; exp_year: number };
    }
  | { id: string; type: string };

/**
 * What the Polar SDK throws for an HTTP error it knows: the parsed body, whose
 * `error` names the case. Matched on that name, not the status: the SDK maps
 * every 403 from the revoke endpoint to "already canceled", and a token
 * missing the `subscriptions:write` scope is a 403 too. Reading that as
 * "nothing to revoke" would delete the account and keep billing it.
 */
const PolarRefusal = v.object({ error: v.object({ error: v.string() }) });

/** The name of the refusal Polar answered with ("ResourceNotFound"…), or
 * null for anything else: a network failure, a body the SDK could not read. */
export function polarRefusal(cause: unknown): string | null {
  const refusal = v.safeParse(PolarRefusal, cause);
  return refusal.success ? refusal.output.error.error : null;
}

// Imported on first use: the SDK is 130 KB that every cold start would
// otherwise parse, for the few routes that call it.
export const polarFor = async (env: Env): Promise<BillingProvider> => {
  if (env.BILLING) return env.BILLING;
  const { createPolar } = await import("@polar-sh/sdk/2026-04");
  const polar = createPolar({
    // Unset only when billing is off, and the routes answer 404 first.
    accessToken: env.POLAR_ACCESS_TOKEN ?? "",
    environment: env.POLAR_SERVER ?? "sandbox",
  });
  const portal = polar.customerPortal;
  return {
    ...polar,
    customerPortal: {
      ...portal,
      orders: {
        ...portal.orders,
        // The SDK types Polar's empty 202 as `unknown`. Nothing in it is
        // read, so it is dropped here rather than handed on.
        generateInvoice: async (id, auth) => {
          await portal.orders.generateInvoice(id, auth);
        },
      },
    },
  };
};

/**
 * Which plan a Polar product grants: an explicit allowlist that fails
 * closed. Both the monthly and yearly product for a plan map to the same
 * plan. An unrecognized product id (a misconfigured env var, a new Polar
 * product nobody wired up, a stale id from a deleted product) must never
 * grant a plan by falling through to the highest tier — that's how a mapping
 * mistake used to hand out Pro for free (see issue #17).
 */
export function planForProduct(env: Env, productId: string | undefined): "hobby" | "pro" | null {
  if (!productId) return null;
  if (productId === env.POLAR_HOBBY_PRODUCT_ID) return "hobby";
  if (productId === env.POLAR_PRO_PRODUCT_ID) return "pro";
  if (productId === env.POLAR_HOBBY_YEARLY_PRODUCT_ID) return "hobby";
  if (productId === env.POLAR_PRO_YEARLY_PRODUCT_ID) return "pro";
  return null;
}
