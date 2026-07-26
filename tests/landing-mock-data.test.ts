import { describe, expect, test } from "bun:test";
import { heatmapData } from "../src/app/lib/landing-mock-data";

describe("heatmapData", () => {
  test("covers every hour of every day of the week", () => {
    const rows = heatmapData();
    expect(rows).toHaveLength(7 * 24);
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        expect(rows.some((r) => r.dayOfWeek === d && r.hour === h)).toBe(true);
      }
    }
  });

  test("is deterministic across calls (seeded generator)", () => {
    expect(heatmapData()).toEqual(heatmapData());
  });

  test("weekday business hours run hotter than the weekend", () => {
    const rows = heatmapData();
    const weekdayBusiness = rows.find((r) => r.dayOfWeek === 2 && r.hour === 12)!;
    const weekend = rows.find((r) => r.dayOfWeek === 6 && r.hour === 12)!;
    expect(weekdayBusiness.clicks).toBeGreaterThan(weekend.clicks);
  });
});
