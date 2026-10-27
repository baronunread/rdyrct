import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { addActiveCustomDomain } from "./orgs";

const password = "test-password-123";

/**
 * Importing from another service (#383). Once the rows are sent, the import
 * runs in a workflow on the server, so the page can be closed: coming back
 * shows the outcome, read from the server rather than from the tab.
 */
test("an import runs on the server and is still there after a reload (#383)", async ({ page }) => {
  // Waiting for the domain to go active can take most of the default budget.
  test.slow();

  const email = `link-import-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email, "pro");
  const host = await addActiveCustomDomain(page, `import-${Date.now()}.example.com`);

  await page.goto("/import");
  // The consent banner sits over the bottom-right corner, where each step
  // keeps its Continue button. Answer it, as anybody would.
  await page
    .getByRole("region", { name: "Cookie consent" })
    .getByRole("button", { name: "Reject" })
    .click();
  await page.getByRole("button", { name: "Dub" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "dub-links.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Short link,Destination URL,Clicks,Created at",
        `https://${host}/spring,https://example.com/spring?utm_source=news,4,2026-01-01`,
        `https://${host}/summer,https://example.com/summer,0,2026-01-02`,
      ].join("\n"),
    ),
  });
  await expect(page.getByText("2 links found")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Import 2 links" }).click();
  await expect(page.getByRole("heading", { name: "Your links are in" })).toBeVisible({
    timeout: 30_000,
  });

  // The outcome lives on the server, not in the tab.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your links are in" })).toBeVisible();

  await page.goto("/links");
  await expect(page.getByText(`${host}/spring`)).toBeVisible();
  await expect(page.getByText(`${host}/summer`)).toBeVisible();

  // Putting it away offers a new import.
  await page.goto("/import");
  await page.getByRole("button", { name: "Import another file" }).click();
  await expect(page.getByRole("heading", { name: "Where are your links now?" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Where are your links now?" })).toBeVisible();
});
