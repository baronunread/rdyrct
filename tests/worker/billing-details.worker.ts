import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import {
  adminCookie,
  applyTestMigrations,
  billingEnv,
  jsonBody,
  POLAR_HOBBY_YEARLY_PRODUCT_ID,
  POLAR_PRO_PRODUCT_ID,
  unreachableBilling,
} from "./support";
import type { BillingDetails } from "../../src/shared/types";
import type {
  BillingProvider,
  PolarOrder,
  PolarPaymentMethod,
} from "../../src/worker/billing-provider";

/**
 * GET /api/billing/details and GET /api/billing/invoices/:orderId: the card
 * and invoices on the billing page, read from a stand-in Polar (worker tests
 * never reach the real one, see support.ts).
 */

/** What the SDK throws for a refusal it knows: the parsed body on `error`. */
const refusal = (name: string) =>
  Object.assign(new Error(name), { error: { error: name, detail: name } });

const order = (overrides: Partial<PolarOrder> = {}): PolarOrder => ({
  id: "ord_1",
  created_at: "2026-09-14T10:00:00Z",
  status: "paid",
  total_amount: 900,
  currency: "usd",
  customer_id: "cus_mine",
  product_id: POLAR_PRO_PRODUCT_ID,
  is_invoice_generated: true,
  receipt_number: null,
  ...overrides,
});

const visa: PolarPaymentMethod = {
  id: "pm_visa",
  type: "card",
  method_metadata: { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2027 },
};

type Portal = BillingProvider["customerPortal"];
/** A session per customer, its token naming whose it is. */
const sessionsCreate = vi.fn(async ({ customer_id }: { customer_id: string }) => ({
  customer_portal_url: "https://sandbox.polar.sh/portal/test",
  token: `tok_${customer_id}`,
}));
const customersGet = vi.fn<Portal["customers"]["get"]>();
const listPaymentMethods = vi.fn<Portal["customers"]["listPaymentMethods"]>();
const ordersList = vi.fn<Portal["orders"]["list"]>();
const ordersGet = vi.fn<Portal["orders"]["get"]>();
const ordersInvoice = vi.fn<Portal["orders"]["invoice"]>();
const generateInvoice = vi.fn<Portal["orders"]["generateInvoice"]>();
const ordersReceipt = vi.fn<Portal["orders"]["receipt"]>();

const polar: BillingProvider = {
  ...unreachableBilling,
  customerSessions: { create: sessionsCreate },
  customerPortal: {
    customers: { get: customersGet, listPaymentMethods },
    orders: {
      list: ordersList,
      get: ordersGet,
      invoice: ordersInvoice,
      generateInvoice,
      receipt: ordersReceipt,
    },
  },
};

/** The token every portal call must carry: the session of the user's own customer. */
const mine = { accessToken: "tok_cus_mine" };

beforeEach(async () => {
  await applyTestMigrations();
  sessionsCreate.mockClear();
  for (const mock of [
    customersGet,
    listPaymentMethods,
    ordersList,
    ordersGet,
    ordersInvoice,
    generateInvoice,
    ordersReceipt,
  ]) {
    mock.mockReset();
  }
  customersGet.mockResolvedValue({ default_payment_method_id: null });
  listPaymentMethods.mockResolvedValue({ items: [] });
  ordersList.mockResolvedValue({ items: [] });
});

afterEach(async () => {
  await reset();
});

async function call(path: string, cookie: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost/api/billing${path}`, { headers: { cookie } }),
    { ...billingEnv(), BILLING: polar },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

/** The signed-in admin, given a Polar customer id. */
async function customerCookie(customerId = "cus_mine"): Promise<string> {
  const cookie = await adminCookie();
  await env.DB.prepare("update user set polar_customer_id = ? where id = 'admin-1'")
    .bind(customerId)
    .run();
  return cookie;
}

describe("GET /api/billing/details", () => {
  it("requires sign-in", async () => {
    expect((await call("/details", "")).status).toBe(401);
  });

  it("answers nothing, without asking Polar, for somebody Polar has no customer for", async () => {
    const res = await call("/details", await adminCookie());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ card: null, invoices: [] });
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(listPaymentMethods).not.toHaveBeenCalled();
    expect(ordersList).not.toHaveBeenCalled();
  });

  it("lists the default card and the customer's invoices, newest first", async () => {
    customersGet.mockResolvedValue({ default_payment_method_id: "pm_visa" });
    listPaymentMethods.mockResolvedValue({
      items: [
        { id: "pm_link", type: "link" },
        {
          id: "pm_mc",
          type: "card",
          method_metadata: { brand: "mastercard", last4: "4444", exp_month: 1, exp_year: 2030 },
        },
        visa,
      ],
    });
    ordersList.mockResolvedValue({
      items: [
        order({ id: "ord_open", status: "pending", created_at: "2026-10-14T10:00:00Z" }),
        order(),
        order({ id: "ord_draft", status: "draft" }),
        order({
          id: "ord_refund",
          status: "refunded",
          product_id: POLAR_HOBBY_YEARLY_PRODUCT_ID,
          total_amount: 4860,
        }),
        order({ id: "ord_other", product_id: "prod_someone_else" }),
        order({ id: "ord_credit", total_amount: -3420 }),
      ],
    });

    const res = await call("/details", await customerCookie());

    expect(res.status).toBe(200);
    // Read as the user's own Polar customer, through a session for it.
    expect(sessionsCreate).toHaveBeenCalledWith({ customer_id: "cus_mine" });
    expect(ordersList).toHaveBeenCalledWith(
      expect.objectContaining({ sorting: ["-created_at"] }),
      mine,
    );
    expect(listPaymentMethods).toHaveBeenCalledWith(expect.anything(), mine);
    const details = await jsonBody<BillingDetails>(res);
    expect(details.card).toEqual({ brand: "visa", last4: "4242", expMonth: 8, expYear: 2027 });
    expect(details.invoices).toEqual([
      {
        id: "ord_open",
        date: Date.parse("2026-10-14T10:00:00Z"),
        plan: "pro",
        amountCents: 900,
        currency: "usd",
        status: "open",
        pdfUrl: null,
      },
      {
        id: "ord_1",
        date: Date.parse("2026-09-14T10:00:00Z"),
        plan: "pro",
        amountCents: 900,
        currency: "usd",
        status: "paid",
        pdfUrl: "/api/billing/invoices/ord_1",
      },
      expect.objectContaining({ id: "ord_refund", plan: "hobby", status: "refunded" }),
      expect.objectContaining({ id: "ord_other", plan: null }),
      expect.objectContaining({ id: "ord_credit", status: "credit", amountCents: -3420 }),
    ]);
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("falls back to the first card when none is the default", async () => {
    listPaymentMethods.mockResolvedValue({ items: [{ id: "pm_link", type: "link" }, visa] });

    const res = await call("/details", await customerCookie());

    expect((await jsonBody<BillingDetails>(res)).card?.last4).toBe("4242");
  });

  it("answers 502 when Polar fails, so the page falls back to the portal", async () => {
    ordersList.mockRejectedValue(refusal("NotPermitted"));

    const res = await call("/details", await customerCookie());

    expect(res.status).toBe(502);
    expect((await jsonBody<{ message: string }>(res)).message).toMatch(/Polar/);
  });
});

describe("GET /api/billing/invoices/:orderId", () => {
  it("redirects to the PDF of the user's own invoice", async () => {
    ordersGet.mockResolvedValue(order());
    ordersInvoice.mockResolvedValue({ url: "https://polar.example/invoice.pdf" });

    const res = await call("/invoices/ord_1", await customerCookie());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://polar.example/invoice.pdf");
    expect(ordersGet).toHaveBeenCalledWith("ord_1", mine);
    expect(generateInvoice).not.toHaveBeenCalled();
  });

  it("generates the invoice on first download", async () => {
    ordersGet.mockResolvedValue(order({ is_invoice_generated: false }));
    generateInvoice.mockResolvedValue();
    ordersInvoice.mockResolvedValue({ url: "https://polar.example/fresh.pdf" });

    const res = await call("/invoices/ord_1", await customerCookie());

    expect(generateInvoice).toHaveBeenCalledWith("ord_1", mine);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://polar.example/fresh.pdf");
  });

  it("waits for an invoice Polar is still generating", async () => {
    ordersGet.mockResolvedValue(order({ is_invoice_generated: false }));
    generateInvoice.mockResolvedValue();
    // What the sandbox answers in the second before the PDF exists.
    ordersInvoice
      .mockRejectedValueOnce(refusal("InvoiceDoesNotExist"))
      .mockResolvedValue({ url: "https://polar.example/fresh.pdf" });

    const res = await call("/invoices/ord_1", await customerCookie());

    expect(res.status).toBe(302);
    expect(ordersInvoice).toHaveBeenCalledTimes(2);
  });

  it("falls back to the receipt when Polar will not invoice the order", async () => {
    ordersGet.mockResolvedValue(order({ is_invoice_generated: false, receipt_number: "R-1" }));
    generateInvoice.mockRejectedValue(refusal("MissingInvoiceBillingDetails"));
    ordersReceipt.mockResolvedValue({ url: "https://polar.example/receipt.pdf" });

    const res = await call("/invoices/ord_1", await customerCookie());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://polar.example/receipt.pdf");
  });

  it("refuses an order Polar hands back for another customer", async () => {
    ordersGet.mockResolvedValue(order({ customer_id: "cus_someone_else" }));

    const res = await call("/invoices/ord_1", await customerCookie());

    expect(res.status).toBe(404);
    expect(ordersInvoice).not.toHaveBeenCalled();
    expect(generateInvoice).not.toHaveBeenCalled();
  });

  it("refuses an order Polar will not show this customer (another's, or none)", async () => {
    ordersGet.mockRejectedValue(refusal("ResourceNotFound"));

    expect((await call("/invoices/ord_nope", await customerCookie())).status).toBe(404);
  });

  it("refuses without a Polar customer, without asking Polar", async () => {
    expect((await call("/invoices/ord_1", await adminCookie())).status).toBe(404);
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(ordersGet).not.toHaveBeenCalled();
  });

  it("refuses an open order, which has nothing to download yet", async () => {
    ordersGet.mockResolvedValue(order({ status: "pending" }));

    expect((await call("/invoices/ord_1", await customerCookie())).status).toBe(404);
    expect(generateInvoice).not.toHaveBeenCalled();
  });

  it("answers 502 when Polar fails", async () => {
    ordersGet.mockResolvedValue(order());
    ordersInvoice.mockRejectedValue(new Error("network down"));

    expect((await call("/invoices/ord_1", await customerCookie())).status).toBe(502);
  });
});
