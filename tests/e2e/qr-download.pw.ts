import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { createOrg } from "./orgs";

const password = "test-password-123";

/**
 * Width and height straight out of the PNG's own IHDR chunk: an 8-byte
 * signature, then a length and the "IHDR" tag, then width and height as
 * big-endian uint32s at offsets 16 and 20. Reading the file's real pixels
 * rather than trusting the filename is the whole point — the preview-sized
 * export this guards against had a perfectly normal name.
 */
async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("a downloaded QR PNG is big enough to print, not preview-sized (#88)", async ({ page }) => {
  const email = `qr-${Date.now()}@gmail.com`;

  await signUpAndVerify(page, email, password);
  await createOrg(page, "QR Org");
  // QR is a paid feature (PLAN_LIMITS.free.qr === false), so the dialog shows
  // no code at all until the plan allows it.
  await setPlan(page, email);
  await page.reload();

  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await expect(destination).toBeVisible();
  await destination.fill("example.com/qr-download");
  await page.getByRole("button", { name: "Create link" }).click();

  const dialog = page.getByRole("dialog", { name: "Link created" });
  await expect(dialog).toBeVisible();

  const download = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "PNG" }).click(),
  ]).then(([event]) => event);

  const path = await download.path();
  expect(path).toBeTruthy();

  // The preview renders at 208px; exporting from that instance is the bug.
  const { width, height } = await pngSize(path!);
  expect(width).toBe(1024);
  expect(height).toBe(1024);
});
