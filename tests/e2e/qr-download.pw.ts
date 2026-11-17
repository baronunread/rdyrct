import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows, rawSql, setPlan } from "./db";
import { createQuickLink } from "./orgs";

const password = "test-password-123";

// Reads real pixels from the PNG's IHDR chunk: the preview-sized export this
// guards against had a perfectly normal filename.
async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("a downloaded QR PNG is big enough to print, not preview-sized (#88)", async ({ page }) => {
  const email = `qr-${Date.now()}@gmail.com`;

  await signUpAndVerify(page, email, password);

  await createQuickLink(page, "example.com/qr-download");
  const dialog = page.getByRole("dialog", { name: "Link created" });

  const download = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: /PNG/ }).click(),
  ]).then(([event]) => event);

  const path = await download.path();
  expect(path).toBeTruthy();

  // The preview renders at 208px; exporting from that instance is the bug.
  const { width, height } = await pngSize(path!);
  expect(width).toBe(1024);
  expect(height).toBe(1024);
});

async function newLinkDialog(page: import("@playwright/test").Page, email: string) {
  await signUpAndVerify(page, email, password);
  await page.goto("/links");
  await page.getByRole("button", { name: "New link" }).first().click();
  const editor = page.getByRole("dialog", { name: "New link" });
  await expect(editor).toBeVisible();
  return editor;
}

test("styling a QR is paid, generating one is not", async ({ page }) => {
  const email = `qr-look-${Date.now()}@gmail.com`;
  const editor = await newLinkDialog(page, email);

  await expect(editor.getByRole("img", { name: /^QR code for / })).toBeVisible();
  await expect(editor.getByText(/Add your logo, colors, and dot shapes/)).toBeVisible();
  await expect(editor.getByRole("group", { name: "QR customization" })).toBeHidden();
  await expect(editor.getByRole("button", { name: "Customize QR" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await setPlan(page, email);
  await page.reload();

  await page.getByRole("button", { name: "New link" }).first().click();
  const paidEditor = page.getByRole("dialog", { name: "New link" });
  await expect(paidEditor.getByText(/Add your logo, colors, and dot shapes/)).toBeHidden();
  await paidEditor.getByRole("button", { name: "Customize QR" }).click();
  await expect(paidEditor.getByRole("group", { name: "QR customization" })).toBeVisible();
});

test("a downgraded org can still edit a link that has a QR look", async ({ page }) => {
  // The trap: the editor loads a downgraded org's QR overrides and used to submit
  // them, so the server's 402 blocked saving even a title. Set through the database:
  // driving the paid editor first only adds other ways to fail.
  const email = `qr-downgrade-${Date.now()}@gmail.com`;
  const editor = await newLinkDialog(page, email);
  await editor.getByLabel("Destination").fill("example.com/downgrade");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(editor).toBeHidden();

  await rawSql(page, "UPDATE links SET qr_style = 'dots' WHERE destination LIKE ?", [
    "%downgrade%",
  ]);
  await page.reload();

  await page
    .getByRole("button", { name: /Actions for/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const reopened = page.getByRole("dialog", { name: "Edit link" });
  await expect(reopened.getByRole("group", { name: "QR customization" })).toBeHidden();
  // The dialog says the look is kept rather than offering a feature the QR is visibly using (#162).
  await expect(reopened.getByText(/keeps the look it already has/)).toBeVisible();

  await reopened.getByLabel("Title").fill("Renamed on the free plan");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(reopened).toBeHidden();
  await expect(page.getByText("Renamed on the free plan")).toBeVisible();

  // The editor used to clear these fields before sending, silently destroying paid styling (#162).
  const [link] = await queryRows<{ qr_style: string; title: string }>(
    page,
    "select qr_style, title from links where destination like ?",
    ["%downgrade%"],
  );
  expect(link.qr_style).toBe("dots");
  expect(link.title).toBe("Renamed on the free plan");
});
