import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createQuickLink } from "./orgs";
import { queryRows, rawSql } from "./db";

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
  // On seven days there is no separate "Last 7 days": it would repeat Clicks.
  for (const label of ["Clicks", "Countries", "Top source"])
    await expect(page.getByRole("term").getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByRole("term").getByText("Last 7 days")).toHaveCount(0);
  // The header matches Analytics (range, Export CSV); under the title only
  // the destination, and devices get a panel beside countries and referrers.
  await expect(page.getByRole("link", { name: /example\.com\/insights-link/ })).toBeVisible();
  await expect(page.getByText(/^Last click /)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  for (const tab of ["Countries", "Referrers", "Devices"])
    await expect(page.getByRole("tab", { name: tab })).toBeVisible();

  await page.getByLabel("More actions").click();
  await expect(page.getByRole("menuitem", { name: "Edit link" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "QR code" })).toBeVisible();
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

test("Analytics counts clicked links and countries, the map zooms to them, Show all opens every country, and a link's page lists its campaign", async ({
  page,
}) => {
  const email = `insights-full-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await createQuickLink(page, "example.com/insights-full");
  await page.keyboard.press("Escape");

  const [link] = await queryRows<{ id: string; org_id: string; slug: string }>(
    page,
    `select l.id, l.org_id, l.slug from links l
     join org_members m on m.org_id = l.org_id join user u on u.id = m.user_id
     where u.email = ?`,
    [email],
  );
  expect(link).toBeTruthy();
  // Clicks take a redirect each and a flush; the stats read only the
  // rollups, so the rollups carry them: ten countries, ten clicks from
  // Italy down to one from Sweden, so the order is fixed. All of them
  // European, so the map frames Europe.
  const countries = ["IT", "FR", "DE", "ES", "PT", "NL", "BE", "AT", "CH", "SE"];
  const dims = countries.map((code, i) => [link.org_id, code, link.id, countries.length - i]);
  await rawSql(
    page,
    `insert into click_daily (org_id, day, link_id, clicks) values (?, date('now'), ?, 45)`,
    [link.org_id, link.id],
  );
  await rawSql(
    page,
    `insert into click_daily_dims (org_id, dim, day, value, link_id, clicks) values ${dims
      .map(() => `(?, 'country', date('now'), ?, ?, ?)`)
      .join(", ")}`,
    dims.flat(),
  );
  await rawSql(page, "update links set utm_campaign = 'spring-menu' where id = ?", [link.id]);

  await page.goto("/analytics");
  const figure = (label: string) =>
    page
      .locator("dl > div")
      .filter({ has: page.getByRole("term").getByText(label, { exact: true }) });
  await expect(figure("Links clicked").getByRole("definition")).toHaveText("1");
  await expect(figure("Countries").getByRole("definition")).toHaveText("10");
  await expect(figure("Clicks per link").getByRole("definition")).toHaveText("45");

  // The map is zoomed to Europe, and the whole world is one press away.
  await expect(page.getByLabel("Clicks by country")).toBeVisible();
  await page.getByRole("button", { name: "Show the world" }).click();
  await page.getByRole("button", { name: "Zoom to the clicks" }).click();

  // The list beside the map scrolls past nine; Show all, in the card's
  // corner, names the full count and opens every country with a search.
  await page.getByRole("button", { name: "Show all 10" }).click();
  const all = page.getByRole("dialog", { name: "Countries" });
  await expect(all.getByText("Sweden", { exact: true })).toBeVisible();
  await all.getByRole("searchbox", { name: "Search countries" }).fill("aus");
  await expect(all.getByText("Austria", { exact: true })).toBeVisible();
  await expect(all.getByText("Sweden", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(all).toHaveCount(0);

  await page.goto(`/links/${link.slug}`);
  await expect(figure("Countries").getByRole("definition")).toHaveText("10");
  await page.getByRole("tab", { name: "Campaigns" }).click();
  await expect(page.getByText("spring-menu", { exact: true })).toBeVisible();
});

test("Analytics' When card shades clicks by weekday and UTC hour, with totals and a tooltip", async ({
  page,
}) => {
  const email = `insights-when-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await createQuickLink(page, "example.com/insights-when");
  await page.keyboard.press("Escape");

  const [link] = await queryRows<{ id: string; org_id: string }>(
    page,
    `select l.id, l.org_id from links l
     join org_members m on m.org_id = l.org_id join user u on u.id = m.user_id
     where u.email = ?`,
    [email],
  );
  expect(link).toBeTruthy();
  // The stats read only the rollups: 30 clicks in the UTC hour that began
  // two hours ago, on today's day row so the range covers them.
  await rawSql(
    page,
    `insert into click_daily (org_id, day, link_id, clicks) values (?, date('now'), ?, 30)`,
    [link.org_id, link.id],
  );
  await rawSql(
    page,
    `insert into click_hourly (org_id, hour, link_id, clicks)
     values (?, (cast(strftime('%s', 'now') as integer) / 3600 - 2) * 3600000, ?, 30)`,
    [link.org_id, link.id],
  );

  await page.goto("/analytics");
  const card = page.getByRole("tabpanel").filter({ has: page.getByRole("grid") });
  await expect(page.getByRole("tab", { name: "When" })).toBeVisible();
  await expect(page.getByText("UTC", { exact: true })).toBeVisible();

  const grid = page.getByRole("grid", { name: /Clicks by day of the week and hour/ });
  await expect(grid).toBeVisible();
  await expect(card).toBeVisible();
  await expect(grid.getByRole("gridcell", { name: "Total, 30 clicks", exact: true })).toHaveText(
    "30",
  );

  // The one busy cell names its day, its hour range and its clicks in a
  // tooltip, not a native title.
  const busy = grid.getByRole("gridcell", { name: /to \d\d:00, 30 clicks$/ });
  await expect(busy).toHaveCount(1);
  await expect(busy).not.toHaveAttribute("title", /.*/);
  await busy.hover();
  await expect(page.getByText(/^\w{3}, \d\d:00 to \d\d:00 · 30 clicks$/)).toBeVisible();
});

test("the dashboard says what changed and how much of the plan is used", async ({ page }) => {
  await signUpAndVerify(page, `insights-changed-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "example.com/insights-changed");
  await page.keyboard.press("Escape");
  // The Worker answers from the rollup tables; the page is what is under test.
  await page.route("**/api/orgs/*/insights*", (route) =>
    route.fulfill({
      json: {
        days: 7,
        minor: null,
        insights: [
          { kind: "country", country: "BE", current: 1600, previous: 1130, pct: 41 },
          {
            kind: "link_fell",
            link: { id: "l1", slug: "spring-sale", title: "", domain: null },
            current: 80,
            previous: 210,
            pct: 62,
          },
          {
            kind: "first_referrer",
            link: { id: "l2", slug: "menu", title: "", domain: null },
            referrer: "instagram.com",
            clicks: 38,
            since: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10),
          },
        ],
      },
    }),
  );
  await page.goto("/dashboard");

  const changed = page.getByRole("list", { name: "What changed" });
  await expect(changed.getByText("Belgium is up 41% on last week")).toBeVisible();
  await expect(changed.getByText("1.6k clicks, 1.1k last week")).toBeVisible();
  await expect(changed.getByText("/spring-sale fell 62%")).toBeVisible();
  await expect(changed.getByText("210 clicks last week")).toBeVisible();
  await expect(changed.getByText("got its first clicks from instagram.com")).toBeVisible();

  // A free plan: links, clicks and members. No custom domains to count.
  const plan = page.getByRole("list", { name: "Your plan" });
  await expect(plan.getByRole("meter", { name: "Links" })).toBeVisible();
  await expect(plan.getByText("1 of 30")).toBeVisible();
  await expect(plan.getByRole("meter", { name: "Clicks this month" })).toBeVisible();
  await expect(plan.getByRole("meter", { name: "Members" })).toBeVisible();
  await expect(plan.getByRole("meter", { name: "Custom domains" })).toHaveCount(0);
  await page.getByRole("link", { name: /Free plan, open billing/ }).click();
  await expect(page).toHaveURL(/\/billing/);
});

test("nothing that clears the floor reads as one calm line", async ({ page }) => {
  await signUpAndVerify(page, `insights-calm-${Date.now()}@gmail.com`, password);
  await createQuickLink(page, "example.com/insights-calm");
  await page.keyboard.press("Escape");
  await page.route("**/api/orgs/*/insights*", (route) =>
    route.fulfill({ json: { days: 7, insights: [], minor: null } }),
  );
  await page.goto("/dashboard");
  await expect(page.getByText("Nothing stands out this week.")).toBeVisible();
});
