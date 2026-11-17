import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createQuickLink } from "./orgs";
import { exportCsvFrom } from "./download";

const password = "test-password-123";

// #78: built in the browser from data on the page, so the check is clicking the button
// and opening what lands.
test("an owner can export the analytics view as a CSV (#78)", async ({ page }) => {
  await signUpAndVerify(page, `export-${Date.now()}@gmail.com`, password);

  await createQuickLink(page, "example.com/export");
  await page.keyboard.press("Escape");
  // A "No clicks yet" card has no export, so claim a click and one country row.
  await page.route("**/api/orgs/*/stats**", async (route) => {
    const response = await route.fetch();
    // SAFETY: this route is the stats endpoint, whose response always has
    // everClicked and a countries array.
    const stats = (await response.json()) as {
      everClicked: boolean;
      countries: { key: string; clicks: number }[];
    };
    stats.everClicked = true;
    stats.countries = [{ key: "US", clicks: 1 }];
    await route.fulfill({ response, json: stats });
  });

  const { filename, text } = await exportCsvFrom(page, "/analytics");

  expect(filename).toMatch(/^rdyrct-analytics-\d+d-\d{4}-\d{2}-\d{2}\.csv$/);

  // The BOM makes Excel read UTF-8 instead of mangling non-ASCII country names.
  expect(text.startsWith("﻿")).toBe(true);
  expect(text.split("\r\n")[0]).toBe("﻿section,key,clicks");
  // A fresh org has a series but no clicks, so the date rows are what prove
  // the range came through rather than an empty file.
  expect(text).toContain("date,");
});
