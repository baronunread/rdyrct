import { expect, test, type Locator } from "@playwright/test";

// A form error marks its field: the outline, a short reason on the label
// line, focus on the field, and nothing under it moves (AGENTS.md).

// Measured against the page, not the viewport: focusing the marked field may
// scroll, and a scroll is not a shift.
const top = (el: Locator) => el.evaluate((node) => node.getBoundingClientRect().top + scrollY);

test("the report form marks an empty link and moves nothing", async ({ page }) => {
  await page.goto("/report");
  const field = page.getByLabel("Short link");
  const send = page.getByRole("button", { name: "Send report" });
  await expect(send).toBeEnabled({ timeout: 20_000 });
  const before = await top(send);

  await send.click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toBeFocused();
  await expect(page.getByText("Required")).toBeVisible();
  expect(await top(send)).toBeCloseTo(before, 0);

  await field.fill("https://rdyr.cc/abc1234");
  await expect(field).not.toHaveAttribute("aria-invalid");
});

test("reset password marks the field that is wrong and moves nothing", async ({ page }) => {
  await page.goto("/reset-password?token=e2e-not-a-real-token");
  const password = page.getByLabel("New password");
  const confirm = page.getByLabel("Confirm password");
  const submit = page.getByRole("button", { name: "Reset password" });
  await password.fill("short");
  const before = await top(submit);
  await submit.click();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toBeFocused();
  await expect(page.getByText("At least 8 characters")).toBeVisible();
  expect(await top(submit)).toBeCloseTo(before, 0);

  await password.fill("long enough password");
  await confirm.fill("something else");
  await submit.click();
  await expect(password).not.toHaveAttribute("aria-invalid");
  await expect(confirm).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Does not match")).toBeVisible();
  expect(await top(submit)).toBeCloseTo(before, 0);
});
