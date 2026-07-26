import { describe, expect, test } from "bun:test";
import { passwordScore, passwordTips } from "../src/app/lib/password-strength";

describe("passwordTips", () => {
  test("empty password gets every tip", () => {
    expect(passwordTips("")).toEqual([
      "Use 12 or more characters.",
      "Mix upper and lower case.",
      "Add a number.",
      "Add a symbol.",
    ]);
  });

  test("a strong password gets no tips", () => {
    expect(passwordTips("Correct-Horse-Battery-9")).toEqual([]);
  });

  test("missing just a symbol", () => {
    expect(passwordTips("CorrectHorseBattery9")).toEqual(["Add a symbol."]);
  });
});

describe("passwordScore", () => {
  test("below the 8-character minimum scores 0 regardless of variety", () => {
    expect(passwordScore("Aa9!")).toBe(0);
  });

  test("a strong password scores the max (4)", () => {
    expect(passwordScore("Correct-Horse-Battery-9")).toBe(4);
  });

  test("score tracks the tip count: fewer tips, higher score", () => {
    const weaker = passwordScore("aaaaaaaa"); // 8 chars, only lowercase
    const stronger = passwordScore("Aaaaaaaa1"); // adds case mix + a number
    expect(stronger).toBeGreaterThan(weaker);
  });
});
