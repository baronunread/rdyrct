import { describe, expect, test } from "bun:test";
import { heatmapGrid } from "../src/app/lib/click-buckets";

describe("heatmapGrid", () => {
  test("fills a 7 by 24 grid from sparse rows and totals every axis", () => {
    const grid = heatmapGrid([
      { dayOfWeek: 0, hour: 9, clicks: 5 },
      { dayOfWeek: 0, hour: 10, clicks: 7 },
      { dayOfWeek: 6, hour: 10, clicks: 3 },
    ]);
    expect(grid.cells).toHaveLength(7);
    expect(grid.cells.every((row) => row.length === 24)).toBe(true);
    expect(grid.cells[0]?.[10]).toBe(7);
    expect(grid.cells[3]?.[3]).toBe(0);
    expect(grid.dayTotals[0]).toBe(12);
    expect(grid.dayTotals[6]).toBe(3);
    expect(grid.hourTotals[10]).toBe(10);
    expect(grid.total).toBe(15);
    expect(grid.max).toBe(7);
  });

  test("an empty answer is an empty grid", () => {
    const grid = heatmapGrid([]);
    expect(grid.total).toBe(0);
    expect(grid.max).toBe(0);
  });

  test("ignores a row outside the week or the day", () => {
    const grid = heatmapGrid([
      { dayOfWeek: 7, hour: 0, clicks: 4 },
      { dayOfWeek: 0, hour: 24, clicks: 4 },
    ]);
    expect(grid.total).toBe(0);
  });
});
