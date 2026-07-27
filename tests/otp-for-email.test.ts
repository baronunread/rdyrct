import { describe, expect, test } from "bun:test";
import { otpForEmail } from "./e2e/resend";

describe("otpForEmail", () => {
  test("finds the code in a single email object", () => {
    const emails = { data: [{ to: ["a@example.com"], html: "<p>Your code is 123456</p>" }] };
    expect(otpForEmail(emails, "a@example.com")).toBe("123456");
  });

  test("skips emails addressed to a different recipient", () => {
    const emails = {
      data: [
        { to: ["other@example.com"], html: "<p>Your code is 111111</p>" },
        { to: ["a@example.com"], text: "Your code is 222222" },
      ],
    };
    expect(otpForEmail(emails, "a@example.com")).toBe("222222");
  });

  test("ignores objects that mention the email but carry no body", () => {
    const emails = { data: [{ to: ["a@example.com"] }] };
    expect(otpForEmail(emails, "a@example.com")).toBe("");
  });

  test("returns empty for primitives, null, and arrays with no match", () => {
    expect(otpForEmail(null, "a@example.com")).toBe("");
    expect(otpForEmail("just a string", "a@example.com")).toBe("");
    expect(otpForEmail([1, 2, "three"], "a@example.com")).toBe("");
  });
});
