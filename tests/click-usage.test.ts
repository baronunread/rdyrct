import { describe, expect, test } from "bun:test";
import {
  clickCapNotice,
  clickUsageLevel,
  monthKey,
  moreClicksLine,
  nextMonthStart,
  resetDay,
} from "../src/shared/click-usage";
import { PLAN_LIMITS } from "../src/shared/types";
import { PUBLIC_PAGE_META } from "../src/shared/page-meta";

const OCT_31_LATE = Date.UTC(2026, 9, 31, 23, 59, 59, 999);
const NOV_1 = Date.UTC(2026, 10, 1);

describe("the tracked-click caps (#387)", () => {
  test("are the agreed numbers, and every plan has one", () => {
    expect(PLAN_LIMITS.free.trackedClicks).toBe(5_000);
    expect(PLAN_LIMITS.hobby.trackedClicks).toBe(50_000);
    expect(PLAN_LIMITS.pro.trackedClicks).toBe(500_000);
    // Finite, so it survives JSON, and out of reach.
    expect(Number.isFinite(PLAN_LIMITS.unlimited.trackedClicks)).toBe(true);
    expect(PLAN_LIMITS.unlimited.trackedClicks).toBeGreaterThan(PLAN_LIMITS.pro.trackedClicks);
  });

  test("count by UTC calendar month", () => {
    expect(monthKey(OCT_31_LATE)).toBe("2026-10");
    expect(monthKey(NOV_1)).toBe("2026-11");
    expect(nextMonthStart(OCT_31_LATE)).toBe(NOV_1);
    expect(nextMonthStart(Date.UTC(2026, 11, 15))).toBe(Date.UTC(2027, 0, 1));
    expect(resetDay(OCT_31_LATE)).toBe("November 1");
  });

  test("warn from 80% and stop at 100%", () => {
    expect(clickUsageLevel(3_999, 5_000)).toBe("under");
    expect(clickUsageLevel(4_000, 5_000)).toBe("near");
    expect(clickUsageLevel(4_999, 5_000)).toBe("near");
    expect(clickUsageLevel(5_000, 5_000)).toBe("reached");
  });

  test("offer more only where a plan counts more", () => {
    expect(moreClicksLine("free")).toBe("Hobby counts 50,000 clicks a month, and Pro 500,000.");
    expect(moreClicksLine("hobby")).toBe("Pro counts 500,000 clicks a month.");
    expect(moreClicksLine("pro")).toBeNull();
    expect(moreClicksLine("unlimited")).toBeNull();
  });
});

describe("clickCapNotice", () => {
  const org = { plan: "free" as const, role: "owner" };

  test("says nothing until the org and its count have loaded", () => {
    expect(clickCapNotice(undefined, { clicks: 5_000, limit: 5_000 }, OCT_31_LATE)).toBeNull();
    expect(clickCapNotice(org, undefined, OCT_31_LATE)).toBeNull();
  });

  test("says nothing under 80%", () => {
    expect(clickCapNotice(org, { clicks: 3_999, limit: 5_000 }, OCT_31_LATE)).toBeNull();
  });

  test("at the cap, says the links still work before anything else", () => {
    const notice = clickCapNotice(org, { clicks: 5_000, limit: 5_000 }, Date.UTC(2026, 9, 24));
    expect(notice).toEqual({
      text: "This organization has reached the 5,000 clicks its plan counts in October. Your links still work. Clicks past 5,000 this month are not counted until November 1. Upgrade to count them.",
      offerUpgrade: true,
    });
    expect(notice?.text).not.toContain("—");
  });

  test("after a downgrade, names the cap rather than claiming the org recorded only that many", () => {
    // A Pro org with 100,000 clicks this month, now on Free.
    const notice = clickCapNotice(org, { clicks: 100_000, limit: 5_000 }, OCT_31_LATE);
    expect(notice?.text).toContain("has reached the 5,000 clicks its plan counts in October.");
    expect(notice?.text).not.toContain("recorded its 5,000");
  });

  test("tells somebody who is not the owner who can upgrade, and offers them no button", () => {
    const notice = clickCapNotice(
      { ...org, role: "admin" },
      { clicks: 5_000, limit: 5_000 },
      OCT_31_LATE,
    );
    expect(notice?.text).toContain("The owner can upgrade");
    expect(notice?.offerUpgrade).toBe(false);
  });

  test("offers Pro nothing to buy", () => {
    const notice = clickCapNotice(
      { ...org, plan: "pro" },
      { clicks: 500_000, limit: 500_000 },
      OCT_31_LATE,
    );
    expect(notice?.text).not.toContain("pgrade");
    expect(notice?.offerUpgrade).toBe(false);
  });

  test("tells a Pro org at its cap to write to us, and who should write", () => {
    const pro = { ...org, plan: "pro" as const };
    const usage = { clicks: 500_000, limit: 500_000 };
    expect(clickCapNotice(pro, usage, OCT_31_LATE)?.text).toMatch(
      /Your links still work\..* For more, write to support@mail\.rdyrct\.com\.$/,
    );
    expect(clickCapNotice({ ...pro, role: "admin" }, usage, OCT_31_LATE)?.text).toMatch(
      / The owner can write to support@mail\.rdyrct\.com for more\.$/,
    );
    // Only at the cap: at 80% there is nothing to ask for yet.
    expect(
      clickCapNotice(pro, { clicks: 400_000, limit: 500_000 }, OCT_31_LATE)?.text,
    ).not.toContain("write to");
  });

  test("offers Free and Hobby an upgrade, not a mail to us", () => {
    const free = clickCapNotice(org, { clicks: 5_000, limit: 5_000 }, OCT_31_LATE);
    expect(free?.text).not.toContain("write to");
    expect(free?.offerUpgrade).toBe(true);
    const hobby = clickCapNotice(
      { ...org, plan: "hobby" },
      { clicks: 50_000, limit: 50_000 },
      OCT_31_LATE,
    );
    expect(hobby?.text).not.toContain("write to");
    expect(hobby?.text).toContain("Upgrade to count them.");
    expect(hobby?.offerUpgrade).toBe(true);
  });

  test("near the cap, gives the exact count", () => {
    const notice = clickCapNotice(org, { clicks: 4_132, limit: 5_000 }, OCT_31_LATE);
    expect(notice?.text).toContain("4,132 of the 5,000");
  });
});

describe("the hand-written pages agree with PLAN_LIMITS", () => {
  const exact = (n: number) => n.toLocaleString("en-US");

  test.each(["/pricing", "/terms"] as const)("%s names every plan's click count", (path) => {
    const markdown = PUBLIC_PAGE_META[path].markdown;
    for (const plan of ["free", "hobby", "pro"] as const) {
      expect(markdown).toContain(exact(PLAN_LIMITS[plan].trackedClicks));
    }
  });

  test.each(["public/llms.txt", "public/llms-full.txt"])(
    "%s names every plan's click count",
    async (file) => {
      const text = await Bun.file(file).text();
      for (const plan of ["free", "hobby", "pro"] as const) {
        expect(text).toContain(exact(PLAN_LIMITS[plan].trackedClicks));
      }
    },
  );
});
