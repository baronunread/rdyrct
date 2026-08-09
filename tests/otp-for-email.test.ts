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

  test("prefers the code on its own line in the text part over a six-digit colour", () => {
    // The shared email layout inlines hex colours, and "#262336" matches a
    // bare \d{6} search. The real code is the line that holds nothing else.
    const emails = {
      data: [
        {
          to: ["a@example.com"],
          html: `<div style="background:#262336">Your code</div><div>654321</div>`,
          text: "Your verification code\n\nEnter this code to finish signing in.\n\n654321\n",
        },
      ],
    };
    expect(otpForEmail(emails, "a@example.com")).toBe("654321");
  });

  test("returns empty for primitives, null, and arrays with no match", () => {
    expect(otpForEmail(null, "a@example.com")).toBe("");
    expect(otpForEmail("just a string", "a@example.com")).toBe("");
    expect(otpForEmail([1, 2, "three"], "a@example.com")).toBe("");
  });
});
