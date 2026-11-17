import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { rawSql, setPlan } from "./db";
import { addActiveCustomDomain } from "./orgs";

const password = "test-password-123";

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

  await page.getByRole("button", { name: "Import 2 links" }).click();
  await expect(page.getByRole("heading", { name: "Your links are in" })).toBeVisible({
    timeout: 30_000,
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your links are in" })).toBeVisible();

  await page.goto("/links");
  await expect(page.getByText(`${host}/spring`)).toBeVisible();
  await expect(page.getByText(`${host}/summer`)).toBeVisible();

  await page.goto("/import");
  const pastImports = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Past imports" }),
  });
  await expect(page.getByRole("heading", { name: "Your links are in" })).toBeVisible();
  await expect(pastImports).toHaveCount(0);

  await page.getByRole("button", { name: "Import another file" }).click();
  await expect(page.getByRole("heading", { name: "From" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "From" })).toBeVisible();
  await expect(pastImports.getByRole("listitem")).toHaveCount(1);
  await expect(pastImports.getByRole("listitem")).toContainText("Dub");
  await expect(pastImports.getByRole("listitem")).toContainText("2 links");
});

test("a domain the org lacks is added from its row and its links come along (#383)", async ({
  page,
}) => {
  test.slow();

  const email = `link-import-new-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email, "pro");
  const host = await addActiveCustomDomain(page, `import-live-${Date.now()}.example.com`);
  const moving = `import-moving-${Date.now()}.example.com`;

  await page.goto("/import");
  await page
    .getByRole("region", { name: "Cookie consent" })
    .getByRole("button", { name: "Reject" })
    .click();
  await page.getByRole("button", { name: "Short.io" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "shortio-links.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Short link,Destination URL,Title",
        `https://${host}/autumn,https://example.com/autumn,Autumn`,
        `https://${host}/winter,https://example.com/winter,Winter`,
        `https://${moving}/promo,https://example.com/promo,Promo`,
      ].join("\n"),
    ),
  });

  const counts = page.getByRole("list", { name: "What this import does" });
  await expect(counts).toContainText(/2\s*ready/);
  await expect(counts).toContainText(/1\s*left out/);
  await expect(page.getByText("left out until you add the domain")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import 2 links" })).toBeVisible();

  await page.getByRole("button", { name: `Add ${moving}` }).click();
  await expect(page.getByRole("button", { name: "Import 3 links" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(counts).not.toContainText("left out");

  await page.getByRole("button", { name: "Import 3 links" }).click();
  await expect(page.getByRole("heading", { name: "Your links are in" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Next: switch the DNS" }).click();
  const line = page.locator('[data-record="CNAME"]', {
    has: page.locator(`code[title="${moving}"]`),
  });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await expect(line.getByRole("button", { name: "Copy the record" })).toBeVisible();
});

test("a domain whose TXT check gave up is tried again from its row (#383)", async ({ page }) => {
  test.slow();

  const email = `link-import-retry-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email, "pro");
  const moving = `import-retry-${Date.now()}.example.com`;
  const file = {
    name: "dub-links.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      ["Short link,Destination URL", `https://${moving}/promo,https://example.com/promo`].join(
        "\n",
      ),
    ),
  };

  await page.goto("/import");
  await page
    .getByRole("region", { name: "Cookie consent" })
    .getByRole("button", { name: "Reject" })
    .click();
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("button", { name: `Add ${moving}` }).click();
  await expect(page.getByRole("button", { name: "Import 1 link" })).toBeVisible({
    timeout: 30_000,
  });

  await rawSql(
    page,
    "update domains set status = 'error', status_reason = 'We never saw the TXT records. Check them at your DNS provider, then try again.' where hostname = ?",
    [moving],
  );
  await page.reload();
  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(page.getByText("its TXT records never showed up")).toBeVisible();

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByText("its TXT records never showed up")).toHaveCount(0);
});
