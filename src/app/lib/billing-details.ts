import type { OrgPlan } from "@/shared/types";

/**
 * What the billing page shows about payment once the API sends it. Today
 * the card and the invoices live only in Polar's portal, so the page links
 * there; with these it lists them in place.
 *
 * Proposed endpoint: `GET /api/billing/details`, the signed-in user's own,
 * answered from Polar's customer API (payment methods and orders) and
 * cached briefly. `card` is null with no card on file.
 */
export interface BillingDetails {
  card: PaymentCard | null;
  invoices: Invoice[];
}

export interface PaymentCard {
  /** "visa", "mastercard", "amex"… as Polar names it. */
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface Invoice {
  id: string;
  /** Epoch ms. */
  date: number;
  plan: OrgPlan;
  amountCents: number;
  /** ISO 4217, "USD". */
  currency: string;
  status: "paid" | "open";
  /** Polar's invoice PDF, or null before one exists. */
  pdfUrl: string | null;
}
