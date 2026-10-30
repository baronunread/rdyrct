import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";
import { addActiveCustomDomain } from "./orgs";

const password = "test-password-123";

/**
 * Importing from another service (#383), on one page: pick the service, drop
 * the file, import. Once the rows are sent, the import runs in a workflow on
 * the server, so the page can be closed: coming back shows the outcome, read
 * from the server rather than from the tab.
 */
test("an import runs on the server and is still there after a reload (#383)", async ({ page }) => {
  // Waiting for the domain to go active can take most of the default budget.
  test.slow();

  const email = `link-import-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email, "pro");
  const host = await addActiveCustomDomain(page, `import-${Date.now()}.example.com`);

  await page.goto("/import");
  // The consent banner sits over the bottom-right corner, where the Import
  // button is. Answer it, as anybody would.
  await page
    .getByRole("region", { name: "Cookie consent" })
    .getByRole("button", { name: "Reject" })
    .click();
  await expect(page.getByRole("heading", { name: "Import links" })).toBeVisible();
  // Import with no file says so on the drop zone, not in a toast.
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Choose a file first")).toBeVisible();

  await page.getByRole("button", { name: "Dub" }).click();
  await expect(page.getByText("Drop your Dub export here")).toBeVisible();
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

  // The domain is the org's and active, so the links keep it, and the file
  // is checked (nothing written) before Import says how many will go in.
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

  // The finished import is the one on show, so it is not also a past one.
  await page.goto("/import");
  const pastImports = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Past imports" }),
  });
  await expect(page.getByRole("heading", { name: "Your links are in" })).toBeVisible();
  await expect(pastImports).toHaveCount(0);

  // Putting it away offers a new import, and keeps this one in the history.
  await page.getByRole("button", { name: "Import another file" }).click();
  await expect(page.getByRole("heading", { name: "From" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "From" })).toBeVisible();
  await expect(pastImports.getByRole("listitem")).toHaveCount(1);
  await expect(pastImports.getByRole("listitem")).toContainText("Dub");
  await expect(pastImports.getByRole("listitem")).toContainText("2 links");
});
