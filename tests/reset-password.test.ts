import { describe, expect, test } from "bun:test";
import { validateResetPassword } from "../src/app/lib/reset-password";

describe("validateResetPassword", () => {
  test("rejects a password shorter than 8 characters", () => {
    expect(validateResetPassword("short", "short")).toBe("Password must be at least 8 characters.");
  });

  test("rejects a confirmation that doesn't match", () => {
    expect(validateResetPassword("longenough", "different")).toBe("Passwords do not match.");
  });

  test("accepts a valid, matching password pair", () => {
    expect(validateResetPassword("longenough", "longenough")).toBeNull();
  });
});
