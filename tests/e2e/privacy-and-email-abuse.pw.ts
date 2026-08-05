import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./environment";
import { queryRows } from "./db";
import { signUpAndVerify } from "./resend";
import { createOrg } from "./orgs";

const password = "test-password-123";

/** Creates a quick link and returns its slug. The slug comes from D1 rather
 * than from the dialog's text: shared-domain slugs are generated, so there
 * is nothing to predict, and scraping the rendered URL out of surrounding
 * copy is the brittle part of this test, not the part under test. */
async function createQuickLink(page: Page): Promise<string> {
  const destination = page.getByPlaceholder("https://example.com/launch").first();
  await expect(destination).toBeVisible();
  await destination.fill("example.com/referrer-privacy");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();

  const rows = await queryRows<{ slug: string }>(
    page,
    "SELECT slug FROM links WHERE destination LIKE '%referrer-privacy%' ORDER BY created_at DESC LIMIT 1",
  );
  const slug = rows[0]?.slug;
  expect(slug).toBeTruthy();
  return slug!;
}

test("a click records the referring host, never the URL it came from (#20)", async ({ page }) => {
  const email = `referrer-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await createOrg(page, "Referrer Org");
  const slug = await createQuickLink(page);

  // A real referring URL: the path and query are the parts that carry other
  // people's search terms and session tokens, and neither may be stored.
  // Publishing the slug to KV rides the storage queue, so the redirect goes
  // live a moment after the row exists. Poll rather than assume.
  await expect
    .poll(
      async () =>
        (
          await page.request.get(`${appUrl}/${slug}`, {
            headers: {
              referer: "https://forum.example.com/threads/42?q=private+search&token=secret",
            },
            maxRedirects: 0,
          })
        ).status(),
      // Generous: the local storage queue batches on a 5s timeout, so the
      // default 5s poll window is exactly the flaky boundary.
      { message: "slug never became a live redirect", timeout: 30_000 },
    )
    .toBe(302);

  // The click rides a queue, so wait for the consumer rather than assuming
  // it has already landed.
  await expect
    .poll(
      async () => {
        const rows = await queryRows<{ referrer: string }>(
          page,
          "SELECT referrer FROM clicks ORDER BY id DESC LIMIT 1",
        );
        return rows[0]?.referrer ?? null;
      },
      { message: "click never reached the clicks table", timeout: 30_000 },
    )
    .toBe("forum.example.com");

  const stored = await queryRows<{ referrer: string }>(page, "SELECT referrer FROM clicks");
  expect(stored.length).toBeGreaterThan(0);
  for (const row of stored) {
    expect(row.referrer).not.toContain("secret");
    expect(row.referrer).not.toContain("private");
    expect(row.referrer).not.toContain("/");
    expect(row.referrer).not.toContain("?");
  }
});

test("one address cannot be mailed without limit by many callers (#50)", async ({ page }) => {
  const victim = `victim-${Date.now()}@gmail.com`;

  // Every request looks like a different caller as far as the per-caller
  // budget is concerned; only the recipient is shared. Without a
  // recipient-keyed limit every one of these would be accepted.
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await page.request.post(
      `${appUrl}/api/auth/email-otp/request-password-reset`,
      {
        headers: { "content-type": "application/json" },
        data: { email: victim },
        failOnStatusCode: false,
      },
    );
    statuses.push(response.status());
    if (response.status() === 429) break;
  }

  expect(statuses).toContain(429);
});
