import { describe, expect, test } from "bun:test";
import { showsCancelNotice, showsConfirmingNotice } from "../src/app/lib/plan-status-notes";

describe("showsCancelNotice", () => {
  test("true when cancellation is scheduled and the period end is known", () => {
    expect(showsCancelNotice(true, 1700000000000)).toBe(true);
  });

  test("false when nothing is scheduled to cancel", () => {
    expect(showsCancelNotice(false, 1700000000000)).toBe(false);
  });

  test("false when the period end isn't known yet", () => {
    expect(showsCancelNotice(true, null)).toBe(false);
  });
});

describe("showsConfirmingNotice", () => {
  test("true when the confirm poll timed out and the plan is still free", () => {
    expect(showsConfirmingNotice(true, "free")).toBe(true);
  });

  test("false once the plan has actually switched over", () => {
    expect(showsConfirmingNotice(true, "pro")).toBe(false);
  });

  test("false when nothing timed out", () => {
    expect(showsConfirmingNotice(false, "free")).toBe(false);
  });
});
