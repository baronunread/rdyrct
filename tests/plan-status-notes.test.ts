import { describe, expect, test } from "bun:test";
import { showsCancelNotice, showsConfirmingNotice } from "../src/app/lib/plan-status-notes";

describe("showsCancelNotice", () => {
  test("true when cancellation is scheduled and the period end is known", () => {
    expect(showsCancelNotice(true, 1700000000000, false)).toBe(true);
  });

  test("false when nothing is scheduled to cancel", () => {
    expect(showsCancelNotice(false, 1700000000000, false)).toBe(false);
  });

  test("false when the period end isn't known yet", () => {
    expect(showsCancelNotice(true, null, false)).toBe(false);
  });

  test("false while a comp is granting the plan, which the cancellation cannot take away", () => {
    expect(showsCancelNotice(true, 1700000000000, true)).toBe(false);
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
