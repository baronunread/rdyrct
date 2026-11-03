import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { rawSql, setPlan } from "./db";
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

/**
 * A file on a domain the org does not have yet. Its links are left out, with
 * the reason on the domain's row, and never hold back the links on a domain
 * it has: Import works throughout. Adding the domain from its row brings its
 * links in (saved now, answering once it is live), and the last step gives
 * the CNAME as one record line with its own copy button.
 */
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

  // The new domain's row says why its link stays out; the rest can go now.
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

  // The DNS switch: one CNAME line for the moving domain, copied whole.
  await page.getByRole("button", { name: "Next: switch the DNS" }).click();
  const line = page.locator('[data-record="CNAME"]', {
    has: page.locator(`code[title="${moving}"]`),
  });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await expect(line.getByRole("button", { name: "Copy the record" })).toBeVisible();
});

/**
 * A domain whose check gave up (a week without its TXT records) is not a
 * dead end: its links may already use it, so it cannot be deleted and added
 * again. Its row on Import says what happened and tries again in place.
 */
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

  // A week later, the check has given up.
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
