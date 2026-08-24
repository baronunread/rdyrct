import { describe, expect, test } from "bun:test";
import { graceLabel } from "../src/app/lib/grace";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

describe("graceLabel", () => {
  test("counts whole days, rounding up", () => {
    expect(graceLabel(NOW + 30 * DAY, NOW)).toBe("30 days left");
    // Rounding up is what keeps the last day from reading "0 days left":
    // somebody with eight hours has a day to act, not none.
    expect(graceLabel(NOW + DAY / 3, NOW)).toBe("1 day left");
  });

  test("says so once the deadline has passed", () => {
    expect(graceLabel(NOW, NOW)).toBe("the grace period has ended");
    expect(graceLabel(NOW - DAY, NOW)).toBe("the grace period has ended");
  });
});
