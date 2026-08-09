import { describe, expect, test } from "bun:test";
import { firstCount, computeBusinessMetrics } from "../src/worker/routes/admin";

describe("firstCount", () => {
  test("returns the first row's count", () => {
    expect(firstCount([{ n: 42 }])).toBe(42);
  });

  test("returns 0 when there are no rows", () => {
    expect(firstCount([])).toBe(0);
  });
});

describe("computeBusinessMetrics", () => {
  test("computes conversion rate, subscriber counts, and signup delta from raw count rows", () => {
    const metrics = computeBusinessMetrics({
      users: [{ n: 100 }],
      proUsers: [{ n: 25 }],
      compedUserRows: [{ n: 3 }],
      subscriptionRows: [{ status: "active" }, { status: "active" }],
      planCountRows: [
        { plan: "free", n: 60 },
        { plan: "hobby", n: 15 },
        { plan: "pro", n: 25 },
      ],
      signups7dRows: [{ n: 20 }],
      signups7dPrevRows: [{ n: 10 }],
      wauRows: [{ n: 80 }],
    });
    expect(metrics.totalUsers).toBe(100);
    expect(metrics.paidUsers).toBe(25);
    expect(metrics.paidConversionRate).toBe(25);
    expect(metrics.planCounts).toEqual({ free: 60, hobby: 15, pro: 25 });
    // 25 people hold a paid plan and 2 of them pay for it: access and paying
    // are different counts now (#82).
    expect(metrics.payingSubscribers).toBe(2);
    expect(metrics.compedUsers).toBe(3);
    expect(metrics.signups7d).toBe(20);
    expect(metrics.signups7dDelta.pct).toBe(100);
    expect(metrics.wau).toBe(80);
  });

  test("conversion rate is null when there are no users yet", () => {
    const metrics = computeBusinessMetrics({
      users: [],
      proUsers: [],
      compedUserRows: [],
      subscriptionRows: [],
      planCountRows: [],
      signups7dRows: [],
      signups7dPrevRows: [],
      wauRows: [],
    });
    expect(metrics.totalUsers).toBe(0);
    expect(metrics.paidConversionRate).toBeNull();
    expect(metrics.payingSubscribers).toBe(0);
  });
});
