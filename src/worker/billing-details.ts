import type { BillingDetails, Invoice, PaymentCard } from "../shared/types";
import type { Env } from "./env";
import {
  planForProduct,
  polarRefusal,
  type AsCustomer,
  type BillingProvider,
  type PolarOrder,
  type PolarPaymentMethod,
} from "./billing-provider";

/** What a user Polar has no customer for sees: no card, no invoices. */
export const NO_BILLING_DETAILS: BillingDetails = { card: null, invoices: [] };

/** Two years of monthly invoices. Older ones stay in the portal. */
const INVOICE_LIMIT = 24;

/**
 * Acts as one Polar customer: a customer session, whose token the Customer
 * Portal API answers for that customer alone. The same call the portal
 * button makes, so it needs no other scope on the organization token.
 */
async function asCustomer(polar: BillingProvider, customerId: string): Promise<AsCustomer> {
  const session = await polar.customerSessions.create({ customer_id: customerId });
  return { accessToken: session.token };
}

/** The card and invoices the billing page lists, read as the customer. */
export async function billingDetails(
  polar: BillingProvider,
  env: Env,
  customerId: string,
): Promise<BillingDetails> {
  const auth = await asCustomer(polar, customerId);
  const portal = polar.customerPortal;
  const [customer, methods, orders] = await Promise.all([
    portal.customers.get(auth),
    portal.customers.listPaymentMethods({ limit: 10 }, auth),
    portal.orders.list({ limit: INVOICE_LIMIT, sorting: ["-created_at"] }, auth),
  ]);
  return {
    card: cardOf(methods.items, customer.default_payment_method_id ?? null),
    invoices: orders.items.flatMap((order) => invoiceOf(env, order) ?? []),
  };
}

type PolarCard = Extract<PolarPaymentMethod, { method_metadata: object }>;

const isCard = (method: PolarPaymentMethod): method is PolarCard =>
  method.type === "card" && "method_metadata" in method;

/** The default card, or the first one when none is marked default. */
function cardOf(methods: PolarPaymentMethod[], defaultId: string | null): PaymentCard | null {
  const cards = methods.filter(isCard);
  const card = cards.find((method) => method.id === defaultId) ?? cards[0];
  if (!card) return null;
  const { brand, last4, exp_month, exp_year } = card.method_metadata;
  return { brand, last4, expMonth: exp_month, expYear: exp_year };
}

/** How an order reads on the page. A draft was never sent and a void one
 * was cancelled before payment, so neither is an invoice anybody owes. */
const STATUS = {
  draft: null,
  void: null,
  pending: "open",
  paid: "paid",
  // Most of the money stayed paid; the PDF says how much came back.
  partially_refunded: "paid",
  refunded: "refunded",
} satisfies Record<PolarOrder["status"], Invoice["status"] | null>;

function invoiceOf(env: Env, order: PolarOrder): Invoice | null {
  const status = statusOf(order);
  if (!status) return null;
  return {
    id: order.id,
    date: Date.parse(order.created_at),
    plan: planForProduct(env, order.product_id ?? undefined),
    amountCents: order.total_amount,
    currency: order.currency,
    status,
    // An open order has nothing Polar will invoice yet.
    pdfUrl: status === "open" ? null : `/api/billing/invoices/${encodeURIComponent(order.id)}`,
  };
}

/** A paid order below zero is the credit a plan change left, not a charge. */
function statusOf(order: PolarOrder): Invoice["status"] | null {
  const status = STATUS[order.status];
  return status === "paid" && order.total_amount < 0 ? "credit" : status;
}

/** How long to wait for an invoice Polar has just started generating. It
 * documents "usually within seconds". */
const INVOICE_POLLS = 6;
const INVOICE_POLL_MS = 750;

/** Generation refusals that a receipt can stand in for. */
const NO_INVOICE_FOR_ORDER = new Set([
  "MissingInvoiceBillingDetails",
  "OrderNotEligibleForInvoice",
]);

/**
 * Where to download one order's PDF, or null when the order is not this
 * customer's (or does not exist): the caller answers 404 either way, so a
 * stranger learns nothing about whose order an id is. Polar refuses another
 * customer's order to this session already; the id check below says so
 * again in this code.
 *
 * The invoice is generated on first download, not when the list loads:
 * Polar makes it permanent once generated, and most invoices are never
 * opened. An order Polar will not invoice (no billing address, say) falls
 * back to its receipt when it has one. Throws when Polar fails, or when the
 * invoice is still not ready after a few seconds.
 */
export async function invoicePdfUrl(
  polar: BillingProvider,
  customerId: string,
  orderId: string,
): Promise<string | null> {
  const auth = await asCustomer(polar, customerId);
  const orders = polar.customerPortal.orders;
  const order = await orderOf(polar, orderId, auth);
  if (!order || order.customer_id !== customerId) return null;
  // The same orders the list gives a download link to, and no others.
  const status = statusOf(order);
  if (!status || status === "open") return null;
  if (order.is_invoice_generated) return (await orders.invoice(order.id, auth)).url;
  try {
    await orders.generateInvoice(order.id, auth);
  } catch (cause) {
    if (!NO_INVOICE_FOR_ORDER.has(polarRefusal(cause) ?? "") || !order.receipt_number) throw cause;
    return (await orders.receipt(order.id, auth)).url;
  }
  return waitForInvoice(polar, order.id, auth);
}

async function orderOf(
  polar: BillingProvider,
  orderId: string,
  auth: AsCustomer,
): Promise<PolarOrder | null> {
  try {
    return await polar.customerPortal.orders.get(orderId, auth);
  } catch (cause) {
    if (polarRefusal(cause) === "ResourceNotFound") return null;
    throw cause;
  }
}

/** What Polar answers for an invoice it has not finished generating:
 * `InvoiceDoesNotExist` in the sandbox, `ResourceNotFound` in its docs. */
const NOT_YET = new Set(["InvoiceDoesNotExist", "ResourceNotFound"]);

/** Asks for the invoice until Polar has it. */
async function waitForInvoice(
  polar: BillingProvider,
  orderId: string,
  auth: AsCustomer,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await polar.customerPortal.orders.invoice(orderId, auth)).url;
    } catch (cause) {
      if (!NOT_YET.has(polarRefusal(cause) ?? "") || attempt >= INVOICE_POLLS) throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, INVOICE_POLL_MS));
  }
}
