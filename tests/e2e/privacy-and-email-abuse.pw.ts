import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./environment";
import { queryRows } from "./db";
import { signUpAndVerify } from "./resend";

const password = "test-password-123";

/** Creates a quick link and returns its slug. The slug comes from D1 rather
 * than from the dialog's text: shared-domain slugs are generated, so there
 * is nothing to predict, and scraping the rendered URL out of surrounding
 * copy is the brittle part of this test, not the part under test. */
async function createQuickLink(page: Page): Promise<string> {
  const destination = page.getByPlaceholder("Paste a URL, or just start typing").first();
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

  // Each attempt claims its own caller address, which the worker reads from
  // cf-connecting-ip. That is what makes this a test of the recipient budget:
  // no caller's own budget is spent twice, so the per-caller limit cannot be
  // what refuses, and without a recipient-keyed limit every one of these
  // would be accepted.
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await page.request.post(
      `${appUrl}/api/auth/email-otp/request-password-reset`,
      {
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": `203.0.113.${10 + attempt}`,
        },
        data: { email: victim },
        failOnStatusCode: false,
      },
    );
    statuses.push(response.status());
    if (response.status() === 429) break;
  }

  // Refused on the sixth, not merely somewhere: RL_EMAIL_RECIPIENT allows 5
  // a minute in this environment, so the position of the 429 is what names
  // which budget ran out. Anything later would mean the recipient limit let
  // a sixth send through.
  expect(statuses.indexOf(429)).toBe(5);
});

test("a throttled verification email still lands on the code screen (#50)", async ({ page }) => {
  const email = `throttled-${Date.now()}@gmail.com`;

  // The send refused, the account made anyway. That is what the email rate
  // limit looks like from the browser, and the app used to answer it by
  // leaving the person on the signup form: it reads as "signup failed", so
  // they submit again, spend another send, and get the same nothing.
  await page.route("**/api/auth/email-otp/send-verification-otp", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ message: "Too many requests. Try again shortly." }),
    }),
  );

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign up" }).click();

  // The toast shows for 3.25s, and a sign-up under a loaded suite can take
  // longer than the default 5s to answer at all: this waits for the whole
  // round trip, not just for the toast's own life.
  await expect(page.getByText("Too many requests. Try again shortly.")).toBeVisible({
    timeout: 20_000,
  });
  // The code screen, which is where the resend button is, not back at the form.
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend code" })).toBeVisible();
});
