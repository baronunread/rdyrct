import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin } from "./db";

const password = "test-password-123";

/**
 * The admin email export, exercised the only honest way: click the button and
 * open what lands. The worker tests cover the filter and the guard; this
 * covers the part only a browser can prove, that the button actually
 * downloads a CSV an audience import would accept.
 */
test("an admin can export verified user emails as CSV", async ({ page }) => {
  const email = `exporter-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await makePlatformAdmin(page, email);

  await page.goto("/admin/users");
  const button = page.getByRole("button", { name: "Export emails CSV" });
  await expect(button).toBeVisible();

  const download = await Promise.all([page.waitForEvent("download"), button.click()]).then(
    ([d]) => d,
  );
  expect(download.suggestedFilename()).toBe("rdyrct-verified-user-emails.csv");

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");

  const lines = text.split("\r\n");
  // The BOM comes from the shared download helper, so Excel reads UTF-8.
  expect(lines[0]).toBe("﻿email");
  expect(lines).toContain(email);
  // The signup just verified itself through the emulator, so it is the one
  // row the export is guaranteed to contain regardless of other tests.
  expect(lines.filter((line) => line.includes("@")).length).toBeGreaterThan(0);
});
