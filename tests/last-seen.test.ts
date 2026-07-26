import { describe, expect, test } from "bun:test";
import { lastSeenLabel } from "../src/app/lib/last-seen";

const DAY = 86_400_000;

describe("lastSeenLabel", () => {
  test("null: never seen", () => {
    expect(lastSeenLabel(null)).toBe("never");
  });

  test("today", () => {
    expect(lastSeenLabel(Date.now() - 1000)).toBe("today");
  });

  test("yesterday", () => {
    expect(lastSeenLabel(Date.now() - DAY - 1000)).toBe("yesterday");
  });

  test("a few days ago", () => {
    expect(lastSeenLabel(Date.now() - 5 * DAY)).toBe("5d ago");
  });

  test("30+ days ago falls back to a formatted date", () => {
    const ts = Date.now() - 40 * DAY;
    expect(lastSeenLabel(ts)).not.toMatch(/d ago|today|yesterday|never/);
  });
});
