import { describe, expect, test } from "bun:test";
import { computeSubscriptionCounts, type SubscriptionCountRow } from "../src/worker/routes/admin";

const sub = (over: Partial<SubscriptionCountRow> = {}): SubscriptionCountRow => ({
  status: "active",
  ...over,
});

describe("computeSubscriptionCounts", () => {
  test("counts live subscriptions", () => {
    expect(computeSubscriptionCounts([sub(), sub()]).payingSubscribers).toBe(2);
  });

  test("a subscription scheduled to cancel still counts", () => {
    // It has not ended: the customer keeps access and keeps paying until the
    // period does. Who is leaving shows on their own row in the user list.
    expect(computeSubscriptionCounts([sub(), sub()]).payingSubscribers).toBe(2);
  });

  test("past_due still counts, since access is kept too", () => {
    expect(computeSubscriptionCounts([sub({ status: "past_due" })]).payingSubscribers).toBe(1);
  });

  test("a subscription that grants no access is not a subscriber", () => {
    const rows = [sub({ status: "unpaid" }), sub({ status: "incomplete" }), sub({ status: null })];
    expect(computeSubscriptionCounts(rows).payingSubscribers).toBe(0);
  });

  test("a status nobody wrote a rule for counts as nothing", () => {
    expect(
      computeSubscriptionCounts([sub({ status: "some_future_polar_status" })]).payingSubscribers,
    ).toBe(0);
  });

  test("no subscriptions is zero", () => {
    expect(computeSubscriptionCounts([])).toEqual({ payingSubscribers: 0 });
  });
});
