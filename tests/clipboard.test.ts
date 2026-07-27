import { describe, expect, test, mock } from "bun:test";
import { copyToClipboard } from "../src/app/lib/clipboard";

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText } },
    configurable: true,
  });
}

describe("copyToClipboard", () => {
  test("writes the text and toasts the default success message", async () => {
    stubClipboard(async () => {});
    const toast = mock();
    await copyToClipboard("hello", toast);
    expect(toast).toHaveBeenCalledWith("Copied to clipboard");
  });

  test("uses a custom success message when given", async () => {
    stubClipboard(async () => {});
    const toast = mock();
    await copyToClipboard("hello", toast, { success: "Link copied!" });
    expect(toast).toHaveBeenCalledWith("Link copied!");
  });

  test("toasts an error and rethrows when the write fails", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const toast = mock();
    await expect(copyToClipboard("hello", toast)).rejects.toThrow("denied");
    expect(toast).toHaveBeenCalledWith("Could not copy to clipboard", "error");
  });

  test("uses a custom error message when given", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const toast = mock();
    await expect(copyToClipboard("hello", toast, { error: "Copy failed" })).rejects.toThrow();
    expect(toast).toHaveBeenCalledWith("Copy failed", "error");
  });
});
