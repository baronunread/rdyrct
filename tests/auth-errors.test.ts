import { describe, expect, test } from "bun:test";
import { friendlyAuthError } from "../src/app/lib/auth-errors";

describe("friendlyAuthError", () => {
  test("password too short", () => {
    expect(friendlyAuthError({ code: "PASSWORD_TOO_SHORT" })).toBe(
      "Password must be at least 8 characters.",
    );
  });

  test("password too long", () => {
    expect(friendlyAuthError({ code: "PASSWORD_TOO_LONG" })).toBe("Password is too long.");
  });

  test("invalid or expired reset token", () => {
    expect(friendlyAuthError({ code: "INVALID_TOKEN" })).toBe(
      "This reset link is invalid or expired. Request a new one from the sign-in page.",
    );
  });

  test("invalid email domain", () => {
    expect(friendlyAuthError({ code: "INVALID_EMAIL_DOMAIN" })).toBe(
      "Enter a valid email address.",
    );
  });

  test("raw schema error mentioning the email field", () => {
    expect(friendlyAuthError({ message: "[body.email] Invalid input" })).toBe(
      "Enter a valid email address.",
    );
  });

  test("unrecognized error falls back to the server's own message", () => {
    expect(friendlyAuthError({ message: "Something specific broke" })).toBe(
      "Something specific broke",
    );
  });

  test("no code and no message falls back to a generic message", () => {
    expect(friendlyAuthError({})).toBe("Something went wrong");
  });
});
