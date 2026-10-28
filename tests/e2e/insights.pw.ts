import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createQuickLink } from "./orgs";

/**
 * The dashboard, Analytics and a link's page after the redesign: a range
 * control on each, a read-only org that keeps its dashboard, and an
 * Analytics page that says "no clicks yet" once instead of ten times.
 */

const password = "test-password-123";

test("a read-only organization keeps its dashboard, with New link greyed out", async ({ page }) => {
  await signUpAndVerify(page, `insights-locked-${Date.now()}@gmail.com`, password);
  // The lock is the server's to set (a downgrade does it); here the user
  // answer says so, which is all the page reads.
  await page.route("**/api/user", async (route) => {
    const response = await route.fetch();
    // SAFETY: this route is GET /api/user, whose body always carries the orgs list.
    const user = (await response.json()) as { orgs: { locked: boolean }[] };
    for (const org of user.orgs) org.locked = true;
    await route.fulfill({ response, json: user });
  });
  await page.goto("/dashboard");

  // The dashboard, not the first-run form: nobody can make that first link.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toHaveCount(0);
  const newLink = page.getByRole("button", { name: /New link/ });
  await expect(newLink).toHaveAttribute("aria-disabled", "true");
  await newLink.hover();
  await expect(page.getByText("This organization is read-only")).toBeVisible();
});

test("the first-run page names what comes with a link", async ({ page }) => {
  await signUpAndVerify(page, `insights-first-${Date.now()}@gmail.com`, password);
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();
  for (const line of ["Every link gets a QR code", "See who clicks", "Bring your team"])
    await expect(page.getByText(line, { exact: true })).toBeVisible();

  // Submit stays live; a bad address marks the field instead of a toast.
  const field = page.getByRole("textbox", { name: "Destination URL", exact: true });
  await field.fill("not a url");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toBeFocused();
});

test("the dashboard's range control switches the period and locks what the plan hides", async ({
  page,
}) => {
  await signUpAndVerify(page, `insights-range-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "example.com/insights-range");
  await page.keyboard.press("Escape");

  const range = page.getByRole("group", { name: "Range" });
  await expect(range.getByRole("button", { name: "7d", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await range.getByRole("button", { name: "24h", exact: true }).click();
  await expect(range.getByRole("button", { name: "24h", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const label of ["Clicks", "Top country", "Top source"])
    await expect(page.getByRole("term").getByText(label, { exact: true })).toBeVisible();

  // Free shows seven days: 30d stays in the row, locked, and opens the plans.
  const locked = range.getByRole("button", { name: "30d" });
  await expect(locked).toHaveAttribute("aria-disabled", "true");
  // aria-disabled so it reads as unavailable, yet pressing it is the way to
  // the plans; Playwright refuses to click anything aria-disabled unforced.
  await locked.click({ force: true });
  await expect(page).toHaveURL(/\/billing/);
});

test("analytics with links but no clicks offers the newest link", async ({ page }) => {
  await signUpAndVerify(page, `insights-empty-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "example.com/insights-empty");
  await page.keyboard.press("Escape");

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "No clicks yet" })).toBeVisible();
  await expect(page.getByText("All links · last 7 days")).toBeVisible();
  await expect(page.getByRole("group", { name: "Range" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy your newest link" })).toBeVisible();
});

test("a link's page has its QR code, a range and a menu in the header", async ({ page }) => {
  await signUpAndVerify(page, `insights-link-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "example.com/insights-link");
  await page.keyboard.press("Escape");

  await page.goto("/links");
  await page
    .locator("tbody tr")
    .first()
    .getByLabel(/Actions for/)
    .click();
  await page.getByRole("menuitem", { name: "Analytics" }).click();

  await expect(page.getByRole("button", { name: "Show QR code" })).toBeVisible();
  const range = page.getByRole("group", { name: "Range" });
  // Free shows seven days, so that is where the page opens.
  await expect(range.getByRole("button", { name: "7d", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const label of ["Clicks", "Countries", "Top source"])
    await expect(page.getByRole("term").getByText(label, { exact: true })).toBeVisible();

  await page.getByLabel("More actions").click();
  await expect(page.getByRole("menuitem", { name: "Open short link" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete link" })).toBeVisible();
});

test("a top link on a custom domain links to its page with the domain", async ({ page }) => {
  await signUpAndVerify(page, `insights-top-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "example.com/insights-top");
  await page.keyboard.press("Escape");
  // A custom domain and its clicks take DNS and real redirects to make; the
  // page only reads the stats answer, so the answer carries them.
  await page.route("**/api/orgs/*/stats**", async (route) => {
    const response = await route.fetch();
    // SAFETY: this route is the stats endpoint, whose response always has
    // everClicked and a topLinks array.
    const stats = (await response.json()) as {
      everClicked: boolean;
      topLinks: {
        id: string;
        slug: string;
        title: string;
        domain: string | null;
        clicks: number;
      }[];
    };
    stats.everClicked = true;
    stats.topLinks = [
      { id: "top-1", slug: "spring", title: "", domain: "go.example.test", clicks: 12 },
    ];
    await route.fulfill({ response, json: stats });
  });

  await page.goto("/analytics");
  await expect(page.getByRole("link", { name: "/spring" })).toHaveAttribute(
    "href",
    "/links/spring?domain=go.example.test",
  );
});
