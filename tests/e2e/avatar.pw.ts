import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

// A valid 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("upload and remove a profile picture from Settings", async ({ page }) => {
  await signUpAndVerify(page, `avatar-${Date.now()}@gmail.com`, "test-password-123");

  const footerImg = page.getByRole("button", { name: "Account menu" }).locator("img");
  // Starts as a generated blobatar (inline SVG data URI).
  await expect(footerImg).toHaveAttribute("src", /^data:image\/svg\+xml/);

  await page.goto("/settings");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Picture updated")).toBeVisible();

  // Footer now serves the stored avatar, same-origin.
  await expect(footerImg).toHaveAttribute("src", /^\/api\/user\/avatar/);

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Picture removed")).toBeVisible();
  await expect(footerImg).toHaveAttribute("src", /^data:image\/svg\+xml/);
});
