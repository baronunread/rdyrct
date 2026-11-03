import { describe, expect, it } from "bun:test";
import { effectiveLimits, parseLimitOverrides, tierOf } from "../src/shared/limits";
import { PLAN_LIMITS } from "../src/shared/types";

describe("effectiveLimits", () => {
  it("is the plan's own limits with no overrides", () => {
    expect(effectiveLimits("pro")).toEqual(PLAN_LIMITS.pro);
    expect(effectiveLimits("free", {})).toEqual(PLAN_LIMITS.free);
  });

  it("takes the higher of the plan's value and the override, key by key", () => {
    const limits = effectiveLimits("pro", {
      orgs: 3,
      links: 500,
      members: 100,
      domains: 1,
      analyticsDays: 30,
      trackedClicks: 1_000_000,
    });
    expect(limits).toEqual({
      ...PLAN_LIMITS.pro,
      orgs: 3,
      members: 100,
      trackedClicks: 1_000_000,
    });
  });

  it("turns custom QR on but never off", () => {
    expect(effectiveLimits("pro", { qrCustom: true }).qrCustom).toBe(true);
    expect(effectiveLimits("hobby", { qrCustom: true }).qrCustom).toBe(true);
    expect(effectiveLimits("pro", { qrCustom: false }).qrCustom).toBe(true);
    expect(effectiveLimits("free", { qrCustom: false }).qrCustom).toBe(false);
  });
});

describe("on a plan that is not paid", () => {
  const overrides = { orgs: 5, links: 10_000, qrCustom: true, trackedClicks: 9_000_000 };

  it("ignores every override on Free", () => {
    expect(effectiveLimits("free", overrides)).toEqual(PLAN_LIMITS.free);
  });

  it("ignores them on unlimited, which has nothing to raise", () => {
    expect(effectiveLimits("unlimited", overrides)).toEqual(PLAN_LIMITS.unlimited);
  });

  it("applies them on Hobby and Pro", () => {
    expect(effectiveLimits("hobby", overrides).orgs).toBe(5);
    expect(effectiveLimits("pro", overrides).links).toBe(10_000);
  });
});

describe("parseLimitOverrides", () => {
  it("reads none, valid overrides, and drops unknown keys", () => {
    expect(parseLimitOverrides({})).toEqual({});
    expect(parseLimitOverrides({ orgs: 2, qrCustom: true })).toEqual({ orgs: 2, qrCustom: true });
    expect(parseLimitOverrides({ orgs: 2, extra: 1 })).toEqual({ orgs: 2 });
  });

  it("answers null for anything that is not valid overrides", () => {
    for (const candidate of [[], { orgs: 0 }, { orgs: 1.5 }, { links: "3" }, { qrCustom: 1 }, null])
      expect(parseLimitOverrides(candidate)).toBeNull();
  });
});

describe("tierOf", () => {
  it("calls a paid account with custom limits Enterprise", () => {
    expect(tierOf("pro", { orgs: 3 })).toBe("enterprise");
    expect(tierOf("hobby", { qrCustom: true })).toBe("enterprise");
  });

  it("calls a paid account without them by its plan", () => {
    expect(tierOf("pro")).toBe("pro");
    expect(tierOf("hobby", {})).toBe("hobby");
  });

  it("never calls Free or unlimited Enterprise, whatever is saved", () => {
    expect(tierOf("free", { orgs: 3 })).toBe("free");
    expect(tierOf("unlimited", { orgs: 3 })).toBe("unlimited");
  });
});
