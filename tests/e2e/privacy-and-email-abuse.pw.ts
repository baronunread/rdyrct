import { expect, test, type Page } from "@playwright/test";
import { appUrl } from "./environment";
import { queryRows } from "./db";
import { signUpAndVerify, submitSignup } from "./resend";
import { createQuickLink as createLink } from "./orgs";

const password = "test-password-123";

/** The slug comes from D1, not the dialog text. The id lets the click assertion
 * find its own click: the click buffer (#225) is shared by every parallel test
 * and can flush two tests' clicks together. */
async function createQuickLink(page: Page): Promise<{ slug: string; id: string }> {
  await createLink(page, "example.com/referrer-privacy");

  const rows = await queryRows<{ slug: string; id: string }>(
    page,
    "SELECT slug, id FROM links WHERE destination LIKE '%referrer-privacy%' ORDER BY created_at DESC LIMIT 1",
  );
  expect(rows[0]?.slug).toBeTruthy();
  return rows[0]!;
}

test("a click records the referring host, never the URL it came from (#20)", async ({ page }) => {
  const email = `referrer-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  const { slug, id: linkId } = await createQuickLink(page);

  // A real referrer: its path and query carry search terms and session tokens,
  // and neither may be stored.
  const referer = "https://forum.example.com/threads/42?q=private+search&token=secret";

  // Polled every 0.5 s: the buffer (#225) flushes at CLICK_FLUSH_MS. Each attempt
  // re-sends the redirect, since the slug may not be on KV yet and a click is
  // best-effort. Scoped to this link: the buffer batches every test's clicks.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${appUrl}/${slug}`, {
          headers: { referer },
          maxRedirects: 0,
        });
        if (res.status() !== 302) return `redirect answered ${res.status()}`;
        const rows = await queryRows<{ referrer: string }>(
          page,
          "SELECT referrer FROM clicks WHERE link_id = ? ORDER BY id DESC LIMIT 1",
          [linkId],
        );
        return rows[0]?.referrer;
      },
      { message: "click never reached the clicks table", timeout: 25_000, intervals: [500] },
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

  // Each attempt claims its own cf-connecting-ip, so the per-caller limit cannot
  // be what refuses: without a recipient-keyed limit all of these would pass.
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

  // Refused on the fifth: email_recipient allows 4 a minute, so the 429's
  // position names which budget ran out.
  expect(statuses.indexOf(429)).toBe(4);
});

test("a throttled verification email still lands on the code screen (#50)", async ({ page }) => {
  const email = `throttled-${Date.now()}@gmail.com`;

  // The send is refused but the account is made. The app used to leave the person
  // on the signup form, which reads as "failed" and spends another send.
  await page.route("**/api/auth/email-otp/send-verification-otp", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ message: "Too many requests. Try again shortly." }),
    }),
  );

  await submitSignup(page, email, password);

  // Sign-up under a loaded suite can outlast the toast's 3.25s and the default
  // 5s: wait for the whole round trip.
  await expect(page.getByText("Too many requests. Try again shortly.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send a new code" })).toBeVisible();
  await expect(page.getByText("Not there? Check your spam folder")).toBeVisible();
});
