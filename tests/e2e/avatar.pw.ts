import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

test("upload/crop, save, and remove a profile picture from Settings", async ({ page }) => {
  await signUpAndVerify(page, `avatar-${Date.now()}@gmail.com`, "test-password-123");

  const footerImg = page.getByRole("button", { name: "Account menu" }).locator("img");
  await expect(footerImg).toHaveAttribute("src", /^data:image\/svg\+xml/);

  await page.goto("/settings");
  const save = page.getByRole("button", { name: "Save", exact: true });
  const openDialog = () => page.getByRole("button", { name: "Change picture" }).click();

  // A 300x300 PNG built in the page.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 300;
    const x = c.getContext("2d")!;
    x.fillStyle = "#35875e";
    x.fillRect(0, 0, 300, 300);
    return c.toDataURL("image/png");
  });
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");

  // Pencil opens the dialog; its centre is the upload CTA.
  await openDialog();
  const dialog = page.getByRole("dialog", { name: "Profile picture" });
  await expect(dialog.getByRole("button", { name: /Upload a picture/ })).toBeVisible();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "me.png", mimeType: "image/png", buffer: buf });

  // Now the crop view; Apply stages it without saving.
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  await expect(save).toBeEnabled();
  await expect(footerImg).toHaveAttribute("src", /^data:image\/svg\+xml/);

  await save.click();
  await expect(page.getByText("Picture updated")).toBeVisible();
  await expect(footerImg).toHaveAttribute("src", /^\/api\/user\/avatar/);

  // The served picture is cacheable, so a reload does not re-read R2 on every
  // navigation (Sentry RDYRCT-7: R2 error 10058 on simultaneous reads).
  const src = await footerImg.getAttribute("src");
  const served = await page.request.get(src!);
  expect(served.status()).toBe(200);
  expect(served.headers()["cache-control"]).toBe("private, max-age=300");

  // Remove lives in the dialog, and is also deferred to Save.
  await openDialog();
  await dialog.getByRole("button", { name: "Remove picture" }).click();
  await expect(dialog).toBeHidden();
  await save.click();
  await expect(page.getByText("Picture removed")).toBeVisible();
  await expect(footerImg).toHaveAttribute("src", /^data:image\/svg\+xml/);
});
