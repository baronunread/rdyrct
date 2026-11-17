import type { JsonValue } from "../shared/types";
import * as v from "valibot";
import type { Env } from "./env";

// Written out so a test hands the routes a stand-in through BILLING on the env, like a queue or a rate limiter,
// instead of mocking the SDK module.
export interface BillingProvider {
  checkouts: {
    create(options: {
      products: string[];
      success_url: string;
      return_url?: string;
      customer_email: string;
      metadata: { userId: string };
      allow_discount_codes: boolean;
    }): Promise<{ url: string }>;
    // Checkout-confirm fallback (POST /checkout/:id/confirm): for when the webhook never lands.
    get(id: string): Promise<{
      status: string;
      product_id: string | null;
      customer_id: string | null;
      metadata: Record<string, JsonValue>;
    }>;
  };
  customerSessions: {
    create(options: {
      customer_id: string;
    }): Promise<{ customer_portal_url: string; token: string }>;
  };
  subscriptions: {
    // Needs the token subscriptions:write scope (#337).
    revoke(id: string): Promise<{ id: string }>;
    // Live subscriptions, so deletion revokes real ones, not a stored id that may be a placeholder.
    list(query: {
      customer_id: string;
      active: boolean;
      limit: number;
    }): Promise<{ items: { id: string; product_id: string }[] }>;
  };
  // Called with a customer session token: needs no scope beyond customer_sessions:write, where the organization
  // orders and customers endpoints need orders:read and customers:read.
  customerPortal: {
    customers: {
      get(auth: AsCustomer): Promise<{ default_payment_method_id?: string | null }>;
      listPaymentMethods(
        query: { limit: number },
        auth: AsCustomer,
      ): Promise<{ items: PolarPaymentMethod[] }>;
    };
    orders: {
      list(
        query: { limit: number; sorting: "-created_at"[] },
        auth: AsCustomer,
      ): Promise<{ items: PolarOrder[] }>;
      get(id: string, auth: AsCustomer): Promise<PolarOrder>;
      invoice(id: string, auth: AsCustomer): Promise<{ url: string }>;
      generateInvoice(id: string, auth: AsCustomer): Promise<void>;
      receipt(id: string, auth: AsCustomer): Promise<{ url: string }>;
    };
  };
}

export interface AsCustomer {
  accessToken: string;
}

export interface PolarOrder {
  id: string;
  created_at: string;
  status: "draft" | "pending" | "paid" | "refunded" | "partially_refunded" | "void";
  // Cents, tax included. Negative for the credit a plan change leaves.
  total_amount: number;
  currency: string;
  customer_id: string;
  product_id: string | null;
  is_invoice_generated: boolean;
  receipt_number: string | null;
}

export type PolarPaymentMethod =
  | {
      id: string;
      type: "card";
      method_metadata: { brand: string; last4: string; exp_month: number; exp_year: number };
    }
  | { id: string; type: string };

// Matched on the error name, not the status: the SDK maps every 403 from the revoke endpoint to already canceled, and a token missing
// subscriptions:write is a 403 too. Reading that as nothing to revoke would delete the account and keep billing it.
const PolarRefusal = v.object({ error: v.object({ error: v.string() }) });

export function polarRefusal(cause: unknown): string | null {
  const refusal = v.safeParse(PolarRefusal, cause);
  return refusal.success ? refusal.output.error.error : null;
}

// Imported on first use: the SDK is 130 KB that every cold start would otherwise parse.
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
        generateInvoice: async (id, auth) => {
          await portal.orders.generateInvoice(id, auth);
        },
      },
    },
  };
};

// An explicit allowlist that fails closed: an unrecognized product id must never fall through to the highest tier (#17).
export function planForProduct(env: Env, productId: string | undefined): "hobby" | "pro" | null {
  if (!productId) return null;
  if (productId === env.POLAR_HOBBY_PRODUCT_ID) return "hobby";
  if (productId === env.POLAR_PRO_PRODUCT_ID) return "pro";
  if (productId === env.POLAR_HOBBY_YEARLY_PRODUCT_ID) return "hobby";
  if (productId === env.POLAR_PRO_YEARLY_PRODUCT_ID) return "pro";
  return null;
}
