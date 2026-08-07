import { describe, expect, test } from "bun:test";
import {
  SUBSCRIPTION_ACCESS,
  resolveEffectivePlan,
  subscriptionGrantsAccess,
} from "../src/worker/entitlement";

describe("subscriptionGrantsAccess", () => {
  test("active and trialing subscriptions keep access", () => {
    expect(subscriptionGrantsAccess("active")).toBe(true);
    expect(subscriptionGrantsAccess("trialing")).toBe(true);
  });

  test("past_due keeps access, on purpose (#84)", () => {
    // Polar retries a failed payment for days and revokes when it gives up.
    // Cutting access at the first failure punishes an expired card.
    expect(subscriptionGrantsAccess("past_due")).toBe(true);
  });

  test("unpaid, canceled and incomplete do not", () => {
    expect(subscriptionGrantsAccess("unpaid")).toBe(false);
    expect(subscriptionGrantsAccess("canceled")).toBe(false);
    expect(subscriptionGrantsAccess("incomplete")).toBe(false);
    expect(subscriptionGrantsAccess("incomplete_expired")).toBe(false);
  });

  test("fails closed on a status nobody has written a rule for", () => {
    expect(subscriptionGrantsAccess("some_new_polar_status")).toBe(false);
    expect(subscriptionGrantsAccess(null)).toBe(false);
    expect(subscriptionGrantsAccess(undefined)).toBe(false);
  });

  test("every status in the table has an explicit decision", () => {
    for (const [status, allowed] of Object.entries(SUBSCRIPTION_ACCESS))
      expect(subscriptionGrantsAccess(status)).toBe(allowed);
  });
});

describe("resolveEffectivePlan", () => {
  test("no subscription and no comp is free", () => {
    expect(resolveEffectivePlan({})).toBe("free");
  });

  test("an entitling subscription grants its plan", () => {
    expect(resolveEffectivePlan({ subscriptionPlan: "pro", subscriptionStatus: "active" })).toBe(
      "pro",
    );
  });

  test("a subscription in a non-entitling status grants nothing", () => {
    expect(resolveEffectivePlan({ subscriptionPlan: "pro", subscriptionStatus: "unpaid" })).toBe(
      "free",
    );
  });

  test("a comp outranks the subscription underneath it", () => {
    expect(
      resolveEffectivePlan({
        compPlan: "pro",
        subscriptionPlan: "hobby",
        subscriptionStatus: "active",
      }),
    ).toBe("pro");
  });

  test("a comp survives a subscription that grants nothing", () => {
    // This is the case #81 was written about: revoking a subscription must
    // not strip access an admin granted by hand.
    expect(resolveEffectivePlan({ compPlan: "hobby", subscriptionPlan: null })).toBe("hobby");
  });
});
