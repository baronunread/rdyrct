// fallow-ignore-file code-duplication -- specs repeat their setup so each reads on its own
import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, queryRows } from "./db";
import { createQuickLink, expectRedirect } from "./orgs";

/**
 * Admin link moderation through the screen an admin actually uses (#67).
 *
 * The worker tests cover enforcement. This covers the part only a browser
 * can: that somebody holding an abuse report can find the link by its
 * destination, stop it, and see that it stopped.
 */

const password = "test-password-123";

/**
 * The admin's PATCH to a link, answered. The row's badge is not the moment
 * the request finished: any refetch of the list between the request's D1
 * write and its KV write already shows the new state, and on a loaded dev
 * server that gap was long enough for the redirect check to land in it and
 * read the old KV value (a 403 where a restored link should 302).
 */
const linkPatch = (page: import("@playwright/test").Page) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && /\/api\/admin\/links\/[^/]+$/.test(response.url()),
  );

test("an admin can find a link by destination and suspend it", async ({ page }) => {
  // A normal account with a link to be reported.
  const ownerEmail = `owner-${Date.now()}@gmail.com`;
  const destination = `https://phishy-${Date.now()}.example/login`;
  await signUpAndVerify(page, ownerEmail, password);

  await createQuickLink(page, destination);

  const slug = (
    await queryRows<{ slug: string }>(page, "select slug from links where destination = ?", [
      destination,
    ])
  )[0].slug;

  // The link redirects, which is the thing suspension has to stop. Polled,
  // because publishing rides the storage queue and is eventual by design.
  await expect
    .poll(async () => (await page.request.get(`/${slug}`, { maxRedirects: 0 })).status(), {
      timeout: 15_000,
      message: "the link never started redirecting",
    })
    .toBe(302);

  // Now an admin, holding the report.
  await makePlatformAdmin(page, ownerEmail);

  // Reached the way an admin reaches it: one Platform entry in the sidebar,
  // then the section tabs. Four sidebar entries put "Links" there twice
  // meaning two different things.
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Platform" }).click();
  // Scoped to the section tabs: the sidebar's own "Links" (the current
  // organization's) is still on screen, and that ambiguity is why the four
  // platform entries came out of the sidebar in the first place.
  await page
    .getByRole("navigation", { name: "Platform sections" })
    .getByRole("link", { name: "Links" })
    .click();
  await expect(page).toHaveURL(/\/admin\/links$/);
  await expect(page.getByRole("heading", { name: "Links" })).toBeVisible();

  await page.getByRole("textbox", { name: "Search links" }).fill(destination);
  const row = page.getByRole("row").filter({ hasText: slug });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Suspend lives in the row's actions menu, next to restore and delete,
  // rather than as a button of its own on every row.
  await row.getByRole("button", { name: `Actions for ${slug}` }).click();
  await page.getByRole("menuitem", { name: "Suspend link" }).click();
  const dialog = page.getByRole("dialog", { name: "Suspend this link" });
  await expect(dialog).toBeVisible();
  // The real promise (#101): KV reaches every location within a minute, not
  // at once.
  await expect(dialog.getByText(/stops within a minute everywhere/)).toBeVisible();
  // A suspension with no reason is not answerable later, so it is refused:
  // the button stays pressable and the empty field is marked instead.
  const reason = dialog.getByRole("textbox", { name: "Reason" });
  await dialog.getByRole("button", { name: "Suspend link" }).click();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expect(reason).toBeFocused();
  await expect(dialog.getByText("Required", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expectRedirect(page, slug, destination);
  await reason.fill("phishing report, ticket 412");
  await expect(reason).not.toHaveAttribute("aria-invalid", "true");
  const suspended = linkPatch(page);
  await dialog.getByRole("button", { name: "Suspend link" }).click();
  expect((await suspended).ok()).toBe(true);

  await expect(row.getByText("suspended")).toBeVisible({ timeout: 10_000 });

  // The redirect is gone, and the row and its clicks are not. Not polled:
  // the suspend writes KV in its own request, not through the queue (#101),
  // so once that request has answered, the redirect has stopped.
  expect((await page.request.get(`/${slug}`, { maxRedirects: 0 })).status()).not.toBe(302);

  const rows = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from links where slug = ?",
    [slug],
  );
  expect(Number(rows[0].n)).toBe(1);

  // Restoring writes KV the same way.
  await row.getByRole("button", { name: `Actions for ${slug}` }).click();
  await page.getByRole("menuitem", { name: "Restore link" }).click();
  const restore = page.getByRole("dialog", { name: "Restore this link?" });
  await expect(restore.getByText(/again within a minute/)).toBeVisible();
  const restored = linkPatch(page);
  await restore.getByRole("button", { name: "Restore link" }).click();
  expect((await restored).ok()).toBe(true);
  await expect(row.getByText("suspended")).toBeHidden({ timeout: 10_000 });
  expect((await page.request.get(`/${slug}`, { maxRedirects: 0 })).status()).toBe(302);

  // And it is answerable. The log is its own section, since it records bans
  // and org deletions too, not only link actions.
  await page
    .getByRole("navigation", { name: "Platform sections" })
    .getByRole("link", { name: "Audit log" })
    .click();
  await expect(page.getByText("link.suspend").first()).toBeVisible();
  await expect(page.getByText(/ticket 412/).first()).toBeVisible();
});

test("the Links tab is invisible and unreachable for a normal user", async ({ page }) => {
  await signUpAndVerify(page, `plain-${Date.now()}@gmail.com`, password);

  // By href, not by label: the app's own "Links" tab is called that too, and
  // a name-based assertion would pass for the wrong reason.
  await expect(page.locator('a[href="/admin/links"]')).toHaveCount(0);

  // 404, not 403: a 403 would confirm the route exists.
  const res = await page.request.get("/api/admin/links");
  expect(res.status()).toBe(404);
});

test("anonymous links and the audit log are reachable, not buried under the list (#67)", async ({
  page,
}) => {
  // They used to sit below up to 200 link rows, which is the same as not
  // being there at all.
  const email = `admin-nav-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await makePlatformAdmin(page, email);

  await page.goto("/admin/links");
  await page.getByRole("button", { name: "Anonymous" }).click();
  await expect(page.getByRole("textbox", { name: "Search anonymous links" })).toBeVisible();

  // And the big table is out of the way while it is open. Both searches carry
  // the same placeholder, so the label is what tells them apart.
  await expect(page.getByRole("textbox", { name: "Search links" })).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Platform sections" })
    .getByRole("link", { name: "Audit log" })
    .click();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
});

test("the platform table fits its card instead of running off the side", async ({ page }) => {
  // An auto-layout table lets a long destination set the column width and
  // push the row past the card, and `max-w` on the cell does nothing about
  // it. Asserted as "the page never scrolls sideways", which is the symptom.
  const email = `admin-layout-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  await createQuickLink(page, `https://example.com/${"a-very-long-path-segment-".repeat(6)}end`);

  await makePlatformAdmin(page, email);
  await page.goto("/admin/links");
  await expect(page.getByRole("heading", { name: "Links" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("an admin sees a suspended org and restores its links in bulk", async ({ page }) => {
  const email = `admin-bulk-${Date.now()}@gmail.com`;
  const destination = `https://bulk-${Date.now()}.example/page`;
  await signUpAndVerify(page, email, password);
  await createQuickLink(page, destination);
  await makePlatformAdmin(page, email);

  const link = (
    await queryRows<{ slug: string; org_id: string }>(
      page,
      "select slug, org_id from links where destination = ?",
      [destination],
    )
  )[0];
  const suspend = await page.request.post(`/api/admin/links/orgs/${link.org_id}/suspend`, {
    data: { reason: "bulk spec" },
  });
  expect(suspend.ok()).toBe(true);

  // The org list says so: it used to show nothing.
  await page.goto("/admin/orgs");
  await expect(page.getByText("suspended").first()).toBeVisible({ timeout: 10_000 });

  await page.goto(`/admin/links?org=${link.org_id}`);
  await page.getByLabel("Filter by status").selectOption("Suspended");
  await page.getByRole("checkbox", { name: "Select all links on this page" }).check();
  await page.getByRole("button", { name: "Restore selected" }).click();
  await expect(page.getByText(/1 link restored/)).toBeVisible({ timeout: 10_000 });

  await expect
    .poll(async () => (await page.request.get(`/${link.slug}`, { maxRedirects: 0 })).status(), {
      timeout: 15_000,
    })
    .toBe(302);
});

test("a visitor reports a link and an admin sees and dismisses the report", async ({ page }) => {
  const email = `admin-report-${Date.now()}@gmail.com`;
  const destination = `https://reported-${Date.now()}.example/page`;
  await signUpAndVerify(page, email, password);
  await createQuickLink(page, destination);
  await makePlatformAdmin(page, email);
  const slug = (
    await queryRows<{ slug: string }>(page, "select slug from links where destination = ?", [
      destination,
    ])
  )[0].slug;

  await page.goto(`/report?link=${slug}`);
  await page.getByLabel("Details (optional)").fill("asks for a card number");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Thanks. We will look at it.")).toBeVisible({ timeout: 15_000 });
  // The owner is on the free plan, so the report warns the link at once.
  // A paid org's link would only be queued (tests/worker/link-states).
  const warnReason = async () =>
    (
      await queryRows<{ warn_reason: string | null }>(
        page,
        "select warn_reason from links where slug = ?",
        [slug],
      )
    )[0].warn_reason;
  expect(await warnReason()).toBe("Open report");

  await page.goto("/admin/links");
  // Scoped to the view switch: the owned table has a Reports column too.
  await page
    .getByRole("group", { name: "Link lists" })
    .getByRole("button", { name: "Reports", exact: true })
    .click();
  const row = page.getByRole("row").filter({ hasText: slug });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByText("asks for a card number")).toBeVisible();

  await row.getByRole("button", { name: "Dismiss" }).click();
  // This report leaves the list. Not "No open reports.": the reports table is
  // the whole platform's, and admin-triage.pw.ts files reports of its own in
  // the same run.
  await expect(row).toHaveCount(0, { timeout: 10_000 });
  // Dismissing the only report lifts the warning it set.
  await expect.poll(warnReason).toBeNull();
});
