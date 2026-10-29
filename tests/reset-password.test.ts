import { describe, expect, test } from "bun:test";
import { validateResetPassword } from "../src/app/lib/reset-password";

describe("validateResetPassword", () => {
  test("marks an empty password as required", () => {
    expect(validateResetPassword("", "")).toEqual({ password: "Required" });
  });

  test("marks a password shorter than 8 characters", () => {
    expect(validateResetPassword("short", "short")).toEqual({ password: "At least 8 characters" });
  });

  test("marks a confirmation that doesn't match", () => {
    expect(validateResetPassword("longenough", "different")).toEqual({ confirm: "Does not match" });
  });

  test("accepts a valid, matching password pair", () => {
    expect(validateResetPassword("longenough", "longenough")).toBeNull();
  });
});
