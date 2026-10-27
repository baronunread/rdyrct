import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createQuickLink } from "./orgs";
import { exportCsvFrom } from "./download";

const password = "test-password-123";

/**
 * The export is built in the browser from data already on the page (#78), so
 * the only honest check is the one a user performs: click the button and open
 * what lands.
 */
test("an owner can export the analytics view as a CSV (#78)", async ({ page }) => {
  await signUpAndVerify(page, `export-${Date.now()}@gmail.com`, password);

  // One link, so the org has something to report on.
  await createQuickLink(page, "example.com/export");
  await page.keyboard.press("Escape");

  const { filename, text } = await exportCsvFrom(page, "/analytics");

  // Named so a folder of exports sorts and reads without opening any of them.
  expect(filename).toMatch(/^rdyrct-analytics-\d+d-\d{4}-\d{2}-\d{2}\.csv$/);

  // The BOM is what makes Excel read this as UTF-8 rather than mangling every
  // non-ASCII country name.
  expect(text.startsWith("﻿")).toBe(true);
  expect(text.split("\r\n")[0]).toBe("﻿section,key,clicks");
  // A fresh org has a series but no clicks, so the date rows are what prove
  // the range came through rather than an empty file.
  expect(text).toContain("date,");
});
