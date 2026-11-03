import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createQuickLink } from "./orgs";
import { exportCsvFrom } from "./download";

const password = "test-password-123";

/**
 * Exporting an org's links (#75). The Worker builds the file, so the check is
 * the one a user performs: click Export on /links and open what lands.
 */
test("a member can export the org's links as a CSV (#75)", async ({ page }) => {
  await signUpAndVerify(page, `links-export-${Date.now()}@gmail.com`, password);

  await createQuickLink(page, "example.com/export-me");
  await page.keyboard.press("Escape");

  const { filename, text } = await exportCsvFrom(page, "/links", "Export");

  expect(filename).toMatch(/^rdyrct-links-.+-\d{4}-\d{2}-\d{2}\.csv$/);

  const [header, row, ...rest] = text.split("\r\n");

  // The header names the import reads, so the file goes back in as it came out.
  expect(header).toBe("﻿Short link,Destination URL,Title,Other short links,Created at,Clicks");
  expect(row).toMatch(/^https?:\/\/[^,]+\/[\w-]+,https:\/\/example\.com\/export-me,/);
  expect(rest).toEqual([""]);
});
