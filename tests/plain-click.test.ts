import { describe, expect, test } from "bun:test";
import { isPlainLeftClick } from "@/app/lib/plain-click";

const plain = {
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

describe("isPlainLeftClick", () => {
  test("a bare left click is ours to take over", () => {
    expect(isPlainLeftClick(plain)).toBe(true);
  });

  test("the browser keeps the clicks that mean something else", () => {
    expect(isPlainLeftClick({ ...plain, button: 1 })).toBe(false);
    expect(isPlainLeftClick({ ...plain, defaultPrevented: true })).toBe(false);
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      expect(isPlainLeftClick({ ...plain, [key]: true })).toBe(false);
    }
  });
});
