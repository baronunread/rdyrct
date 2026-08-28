import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

/**
 * The export is built in the browser from data already on the page (#78), so
 * the only honest check is the one a user performs: click the button and open
 * what lands.
 */
test("an owner can export the analytics view as a CSV (#78)", async ({ page }) => {
  await signUpAndVerify(page, `export-${Date.now()}@gmail.com`, password);

  // One link, so the org has something to report on.
  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await expect(destination).toBeVisible();
  await destination.fill("example.com/export");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/analytics");
  const button = page.getByRole("button", { name: "Export CSV" });
  await expect(button).toBeVisible();

  const download = await Promise.all([page.waitForEvent("download"), button.click()]).then(
    ([d]) => d,
  );

  // Named so a folder of exports sorts and reads without opening any of them.
  expect(download.suggestedFilename()).toMatch(/^rdyrct-analytics-\d+d-\d{4}-\d{2}-\d{2}\.csv$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");

  // The BOM is what makes Excel read this as UTF-8 rather than mangling every
  // non-ASCII country name.
  expect(text.startsWith("﻿")).toBe(true);
  expect(text.split("\r\n")[0]).toBe("﻿section,key,clicks");
  // A fresh org has a series but no clicks, so the date rows are what prove
  // the range came through rather than an empty file.
  expect(text).toContain("date,");
});
