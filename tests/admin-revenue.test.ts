import { describe, expect, test } from "bun:test";
import { computeRevenue, type SubscriptionRevenueRow } from "../src/worker/routes/admin";

const sub = (over: Partial<SubscriptionRevenueRow> = {}): SubscriptionRevenueRow => ({
  amount: 900,
  currency: "usd",
  interval: "month",
  status: "active",
  cancelAtPeriodEnd: false,
  ...over,
});

describe("computeRevenue", () => {
  test("sums monthly subscriptions at the amount Polar reported", () => {
    const r = computeRevenue([sub(), sub({ amount: 400 })]);
    expect(r.payingSubscribers).toBe(2);
    expect(r.mrr).toBe(13);
    expect(r.committedMrr).toBe(13);
  });

  test("a discounted subscription contributes its discounted amount (#82)", () => {
    // The old figure multiplied a plan count by a list price, so this row
    // would have counted as the full $9.
    expect(computeRevenue([sub({ amount: 450 })]).mrr).toBe(5);
  });

  test("a yearly subscription contributes a twelfth (#82)", () => {
    expect(computeRevenue([sub({ amount: 9000, interval: "year" })]).mrr).toBe(8);
  });

  test("weekly and daily intervals normalize too", () => {
    expect(computeRevenue([sub({ amount: 100, interval: "week" })]).mrr).toBe(4);
    expect(computeRevenue([sub({ amount: 100, interval: "day" })]).mrr).toBe(30);
  });

  test("an interval with no rule is counted as a subscriber but not as revenue", () => {
    const r = computeRevenue([sub({ interval: "fortnight" })]);
    expect(r.payingSubscribers).toBe(1);
    expect(r.mrr).toBe(0);
  });

  test("a subscription scheduled to cancel is MRR but not committed MRR", () => {
    const r = computeRevenue([sub({ cancelAtPeriodEnd: true })]);
    expect(r.mrr).toBe(9);
    expect(r.committedMrr).toBe(0);
    expect(r.pendingCancellations).toBe(1);
  });

  test("past_due keeps its revenue, since access is kept too", () => {
    expect(computeRevenue([sub({ status: "past_due" })]).mrr).toBe(9);
  });

  test("a subscription that grants no access is neither a subscriber nor revenue", () => {
    const r = computeRevenue([sub({ status: "unpaid" }), sub({ status: "incomplete" })]);
    expect(r.payingSubscribers).toBe(0);
    expect(r.mrr).toBe(0);
  });

  test("reports the currencies it added together", () => {
    const r = computeRevenue([sub(), sub({ currency: "eur" }), sub({ currency: "usd" })]);
    expect(r.mrrCurrencies).toEqual(["eur", "usd"]);
  });

  test("no subscriptions is zero, not a division by anything", () => {
    expect(computeRevenue([])).toEqual({
      payingSubscribers: 0,
      pendingCancellations: 0,
      mrr: 0,
      committedMrr: 0,
      mrrCurrencies: [],
    });
  });
});
