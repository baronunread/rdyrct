import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { openNewLinkDialog } from "./orgs";

const password = "test-password-123";

/** Sets a native colour input the way the picker does when you choose. */
async function pickColour(page: Page, label: string, hex: string) {
  await page.getByLabel(`${label} colour`).evaluate((el, value) => {
    // SAFETY: getByLabel on "… colour" resolves to the chip's <input type=color>.
    const input = el as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, hex);
}

/**
 * A form error marks its field (rdyrct-design). Both refusals here used to
 * end in a toast: one the browser's URL check let through ("copperkettle
 * winter menu" parses as a URL with spaces in it), one only the server can
 * make (another shortener). Each must mark Destination, say why in its label
 * row, and leave focus there with the dialog still open.
 */
test("a refused destination marks the field, not a toast", async ({ page }) => {
  await signUpAndVerify(page, `editor-err-${Date.now()}@gmail.com`, password);
  const editor = await openNewLinkDialog(page);
  const destination = editor.getByRole("textbox", { name: /^Destination/ });

  await destination.fill("copperkettle winter menu");
  await editor.getByRole("button", { name: "Create link" }).click();
  await expect(destination).toHaveAttribute("aria-invalid", "true");
  await expect(destination).toBeFocused();
  await expect(editor.getByText("Not a web address")).toBeVisible();

  // Fixing it drops the mark as it is fixed.
  await destination.fill("bit.ly/abc");
  await expect(destination).not.toHaveAttribute("aria-invalid", "true");

  // The server refuses this one; the editor pins it on the same field.
  await editor.getByRole("button", { name: "Create link" }).click();
  await expect(editor.getByText("Another shortener")).toBeVisible();
  await expect(destination).toHaveAttribute("aria-invalid", "true");
  await expect(destination).toBeFocused();
  await expect(page.locator("[data-toast-mark=error]")).toHaveCount(0);
  await expect(editor).toBeVisible();
});

test("the QR editor checks contrast, and Cancel puts the look back", async ({ page }) => {
  const email = `editor-qr-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email);
  const editor = await openNewLinkDialog(page);
  await editor.getByRole("button", { name: "Customize QR" }).click();

  // The heading says where you are; the dialog keeps its name.
  await expect(editor.getByRole("heading", { name: "QR code" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Back to the link" })).toBeFocused();
  await expect(editor.getByText("Strong contrast, scans well")).toBeVisible();

  const dots = editor.getByRole("group", { name: "Dots" });
  await dots.getByRole("button", { name: "Dots", exact: true }).click();
  await expect(dots.getByRole("button", { name: "Dots", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await pickColour(page, "Dots", "#dddddd");
  await expect(editor.getByText("Low contrast, may not scan")).toBeVisible();

  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor.getByRole("textbox", { name: /^Destination/ })).toBeVisible();
  await editor.getByRole("button", { name: "Customize QR" }).click();
  await expect(editor.getByLabel("Dots colour")).toHaveValue("#17151f");
  await expect(dots.getByRole("button", { name: "Rounded", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(editor.getByText("Strong contrast, scans well")).toBeVisible();
});

test("the organization's QR defaults use the same rows and save in the preview", async ({
  page,
}) => {
  const email = `editor-defaults-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email);
  await page.goto("/organization");

  const save = page.getByRole("button", { name: "Save", exact: true }).last();
  const dot = page.getByRole("group", { name: "Corners" }).getByRole("button", { name: "Dot" });
  await expect(page.getByText("Strong contrast", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();

  await dot.click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("QR defaults saved")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("group", { name: "Corners" }).getByRole("button", { name: "Dot" }),
  ).toHaveAttribute("aria-pressed", "true");

  // A new link starts from them.
  const editor = await openNewLinkDialog(page);
  await editor.getByRole("button", { name: "Customize QR" }).click();
  await expect(editor.getByText("Dot (default)")).toBeVisible();
});
