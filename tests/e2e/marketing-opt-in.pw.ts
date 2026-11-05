import { expect, test, type Page } from "@playwright/test";
import { makePlatformAdmin, queryRows, rawSql } from "./db";
import { latestMailTextTo, signUpAndVerify, subjectsSentTo } from "./resend";

const PASSWORD = "test-password-123";

interface Consent {
  news: string | null;
  newsSource: string | null;
  offers: string | null;
  offersSource: string | null;
  asked: string | null;
}

async function consentOf(page: Page, email: string): Promise<Consent> {
  const [row] = await queryRows<Consent>(
    page,
    `SELECT news_opt_in_at AS news, news_opt_in_source AS newsSource,
            offers_opt_in_at AS offers, offers_opt_in_source AS offersSource,
            marketing_asked_at AS asked FROM user WHERE email = ?`,
    [email],
  );
  return row;
}

/** An existing account the one-time dialog has not asked yet. Test accounts
 * are made already asked (dev-scenarios.ts), so this one opts out of that. */
async function unaskedAccount(page: Page, email: string) {
  const res = await page.request.post("/__dev/test-account", {
    data: { email, password: PASSWORD, asked: false },
  });
  expect(res.status(), await res.text()).toBe(201);
}

const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "What should we email you about?" });

/** The account's row once `ready` holds: the answer is written after the
 * page that sent it has drawn, so it is waited for, not read at once. */
async function settledConsent(
  page: Page,
  email: string,
  ready: (row: Consent) => boolean,
): Promise<Consent> {
  await expect
    .poll(async () => ready(await consentOf(page, email)), { timeout: 15_000 })
    .toBe(true);
  return consentOf(page, email);
}

/** The dialog is gone and the account said no to both lists, at `source`. */
async function expectAnsweredNo(page: Page, email: string, source: string) {
  await expect(dialog(page)).toHaveCount(0);
  const row = await settledConsent(page, email, (r) => r.asked !== null);
  expect(row).toMatchObject({ news: null, offers: null, newsSource: source, offersSource: source });
}

/** A fresh unasked account on the dashboard, with the dialog up. */
async function dialogForNewAccount(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}@example.com`;
  await unaskedAccount(page, email);
  await page.goto("/dashboard");
  await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
  return email;
}

/** A signed-in, already-asked account opted in to the lists given, set in
 * the database: the lists are what the spec is about, not how they were set. */
async function subscriber(page: Page, email: string, lists: { news?: boolean; offers?: boolean }) {
  const res = await page.request.post("/__dev/test-account", {
    data: { email, password: PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(201);
  const now = Date.now();
  // The Explorer refuses a null parameter and sends every one as text, so 0
  // stands for "not opted in" and is cast before the compare.
  await rawSql(
    page,
    `UPDATE user SET news_opt_in_at = nullif(cast(? AS INTEGER), 0), news_opt_in_source = 'settings',
       offers_opt_in_at = nullif(cast(? AS INTEGER), 0), offers_opt_in_source = 'settings' WHERE email = ?`,
    [lists.news ? now : 0, lists.offers ? now : 0, email],
  );
}

/** The unsubscribe link in the newest mail to `email`, once it has come. */
async function unsubscribeLinkIn(page: Page, email: string, footer: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const mail = (await latestMailTextTo(page, email)) ?? "";
        link = mail.includes(footer) ? (mail.match(/Unsubscribe: (\S+)/)?.[1] ?? "") : "";
        return link;
      },
      { timeout: 15_000 },
    )
    .toContain("/unsubscribe?t=");
  return link;
}

test.describe("marketing email opt-in", () => {
  test("sign-up asks nothing about email: onboarding does, last", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByText(/product news|offers/i)).toHaveCount(0);
  });

  test("an account that was never asked sees the dialog once, and a dismissal ends it", async ({
    page,
  }) => {
    const email = await dialogForNewAccount(page, "news-dismiss");
    await page.keyboard.press("Escape");
    await expectAnsweredNo(page, email, "prompt");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog(page)).toHaveCount(0);
  });

  test("turning on only Offers in the dialog opts in to offers, and Settings toggles each list", async ({
    page,
  }) => {
    const email = await dialogForNewAccount(page, "news-settings");
    const news = dialog(page).getByRole("switch", { name: "Product news" });
    const offers = dialog(page).getByRole("switch", { name: "Offers" });
    await expect(news).toBeFocused();
    await expect(news).not.toBeChecked();
    await expect(offers).not.toBeChecked();
    // A switch here only changes the choice: nothing saves before Save.
    await offers.click();
    await expect(offers).toBeChecked();
    // The row's text is part of the target too.
    await dialog(page).getByText("New features and tips").click();
    await expect(news).toBeChecked();
    await news.click();
    await expect(news).not.toBeChecked();
    expect((await consentOf(page, email)).asked).toBeNull();
    await dialog(page).getByRole("button", { name: "Save" }).click();
    await expect(dialog(page)).toHaveCount(0);
    const row = await settledConsent(page, email, (r) => r.offersSource === "prompt");
    expect(row.offers).not.toBeNull();
    expect(row).toMatchObject({ news: null, newsSource: "prompt" });

    await page.goto("/settings");
    const newsSwitch = page.getByRole("switch", { name: "Product news" });
    const offersSwitch = page.getByRole("switch", { name: "Offers" });
    await expect(offersSwitch).toBeChecked({ timeout: 15_000 });
    await expect(newsSwitch).not.toBeChecked();

    await offersSwitch.click();
    await expect(page.getByText("Offers are off")).toBeVisible();
    await expect(offersSwitch).not.toBeChecked();
    await expect.poll(async () => (await consentOf(page, email)).offers).toBeNull();
    expect((await consentOf(page, email)).offersSource).toBe("settings");

    await newsSwitch.click();
    await expect(page.getByText("Product news is on")).toBeVisible();
    await expect.poll(async () => (await consentOf(page, email)).news).not.toBeNull();
    // Turning news on left offers as it was.
    expect((await consentOf(page, email)).offers).toBeNull();
  });

  test("a send to Offers, narrowed to New and Free, reaches only those subscribers, and its link lets them choose", async ({
    page,
  }) => {
    const stamp = Date.now();
    const offersReader = `offers-reader-${stamp}@example.com`;
    const newsReader = `news-reader-${stamp}@example.com`;
    const bothReader = `both-reader-${stamp}@example.com`;
    await subscriber(page, offersReader, { offers: true });
    await subscriber(page, newsReader, { news: true });
    await subscriber(page, bothReader, { news: true, offers: true });

    const admin = `news-admin-${stamp}@example.com`;
    await signUpAndVerify(page, admin, PASSWORD);
    await makePlatformAdmin(page, admin);

    // Platform › Users filters by each list.
    await page.goto("/admin/users");
    await page.getByRole("button", { name: /^Offers/ }).click({ timeout: 15_000 });
    await expect(page.getByRole("row").filter({ hasText: offersReader })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: newsReader })).toHaveCount(0);
    await page.getByRole("button", { name: /^Product news/ }).click();
    await expect(page.getByRole("row").filter({ hasText: newsReader })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: offersReader })).toHaveCount(0);

    await page.goto("/admin/newsletter");
    await expect(page.getByText("Product news · everyone")).toBeVisible({ timeout: 15_000 });
    const reach = page.getByTestId("newsletter-audience");
    await expect(reach).toHaveText(/^\d+ (person|people) on Product news\.$/, { timeout: 15_000 });
    // The list and filters sit behind Edit audience, as three selects.
    await page.getByRole("button", { name: "Edit audience" }).click();
    const picker = page.getByRole("dialog", { name: "Audience" });
    await picker.getByLabel("List").selectOption("offers");
    await expect(reach).toHaveText(/^\d+ (person|people) on Offers\.$/);

    // The readers here made no link and are on Free: New and Free keep them.
    await picker.getByLabel("Stage").selectOption("new");
    await picker.getByLabel("Plan").selectOption("free");
    await picker.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Offers · Free accounts with no link yet")).toBeVisible();
    const narrowed =
      /^(\d+) (person|people) on Offers who are on Free and have not made a link yet\.$/;
    await expect(reach).toHaveText(narrowed);
    const reached = Number((await reach.textContent())?.match(narrowed)?.[1]);
    expect(reached).toBeGreaterThanOrEqual(2);

    // A form error marks its fields; nothing is sent.
    await page.getByRole("button", { name: "Send now" }).click();
    await expect(page.getByText("Add a subject")).toBeVisible();
    await expect(page.getByText("Write the email")).toBeVisible();
    const editor = page.getByRole("textbox", { name: "Message" });
    await expect(editor).toHaveAttribute("aria-invalid", "true");

    const subject = `Offer ${stamp}`;
    await page.getByLabel("Subject").fill(subject);
    // The editor: a heading from the slash menu, a bold word, a link.
    await editor.click();
    await page.keyboard.type("/subtitle");
    await expect(page.getByRole("button", { name: "Subtitle", exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Half off");
    await expect(editor).not.toHaveAttribute("aria-invalid");
    await page.keyboard.press("Enter");
    await page.keyboard.type("This is ");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.type("big");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.type(" news. Read the docs");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.getByRole("button", { name: "Add link" }).click();
    await page.getByPlaceholder("Paste a link").fill("https://rdyrct.com/docs");
    await page.keyboard.press("Enter");
    await expect(editor.locator("h2")).toHaveText("Half off");
    await expect(editor.locator("strong")).toHaveText("big");
    await expect(editor.locator('a[href="https://rdyrct.com/docs"]')).toHaveText("docs");

    await page.getByRole("button", { name: "Send now" }).click();
    const confirm = page.getByRole("dialog", { name: "Send newsletter" });
    await expect(
      confirm.getByText(
        /^This emails \d+ (person|people) on Offers who are on Free and have not made a link yet now\. It cannot be recalled\.$/,
      ),
    ).toBeVisible();
    await confirm.getByRole("button", { name: /^Send to \d/ }).click();
    await expect(page.getByText("Sending", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    // The workflow sends it; the history follows it to Sent.
    const sendRow = page.getByRole("listitem").filter({ hasText: subject });
    await expect(sendRow).toContainText(/Offers · New · Free · /);
    await expect(sendRow.getByText("Sent", { exact: true })).toBeVisible({ timeout: 30_000 });

    const footer = "You get this because you opted in to offers from rdyrct.";
    const link = await unsubscribeLinkIn(page, offersReader, footer);
    await unsubscribeLinkIn(page, bothReader, footer);
    expect(await latestMailTextTo(page, offersReader)).toContain(
      "This is big news. Read the docs (https://rdyrct.com/docs)",
    );
    expect(await subjectsSentTo(page, newsReader)).not.toContain(subject);

    // The link works with no session. The reader on both keeps news only.
    await page.context().clearCookies();
    const bothLink = await unsubscribeLinkIn(page, bothReader, footer);
    await page.goto(bothLink);
    await expect(
      page.getByRole("heading", { name: "Which emails do you want from rdyrct?" }),
    ).toBeVisible();
    const newsBox = page.getByRole("checkbox", { name: /Product news/ });
    const offersBox = page.getByRole("checkbox", { name: /Offers/ });
    await expect(newsBox).toBeChecked();
    await expect(offersBox).toBeChecked();
    await offersBox.uncheck();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Saved" })).toBeVisible();
    await expect(page.getByText("You get product news only.")).toBeVisible();
    const kept = await consentOf(page, bothReader);
    expect(kept.offers).toBeNull();
    expect(kept.news).not.toBeNull();
    // Back to the form: it shows what they chose.
    await page.getByRole("link", { name: "Change which emails you get" }).click();
    await expect(newsBox).toBeChecked();
    await expect(offersBox).not.toBeChecked();

    // The offers reader's link, Unsubscribe from all: off both lists.
    await page.goto(link);
    await expect(page.getByRole("checkbox", { name: /Offers/ })).toBeChecked();
    await page.getByRole("button", { name: "Unsubscribe from all" }).click();
    await expect(page.getByRole("heading", { name: "You are unsubscribed" })).toBeVisible();
    await expect(page.getByText(/You will not get any rdyrct email/)).toBeVisible();
    expect(await consentOf(page, offersReader)).toMatchObject({ offers: null, news: null });
  });

  test("an admin schedules a send for later, sees it waiting with Cancel, and cancels it", async ({
    page,
  }) => {
    const stamp = Date.now();
    await subscriber(page, `sched-reader-${stamp}@example.com`, { news: true });
    const admin = `sched-admin-${stamp}@example.com`;
    await signUpAndVerify(page, admin, PASSWORD);
    await makePlatformAdmin(page, admin);
    await page.goto("/admin/newsletter");

    const subject = `Later ${stamp}`;
    await page.getByLabel("Subject").fill(subject);
    await page.getByRole("textbox", { name: "Message" }).click();
    await page.keyboard.type("Coming soon.");

    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Schedule the send" });
    const when = picker.getByLabel("Date and time");
    // Starts on tomorrow at 9, said back in words with the time zone.
    await expect(when).toHaveValue(/T09:00$/);
    await expect(
      picker.getByText(/^Goes \w+day \d+ \w+ at 09:00, your time \(.+\)\.$/),
    ).toBeVisible();
    // A time already gone is marked on the field.
    await when.fill("2020-01-01T09:00");
    await picker.getByRole("button", { name: "Schedule send" }).click();
    await expect(when).toHaveAttribute("aria-invalid", "true");
    // A month ahead at 10:30, in the browser's own time.
    const later = new Date();
    later.setDate(later.getDate() + 30);
    const pad = (n: number) => String(n).padStart(2, "0");
    await when.fill(
      `${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}T10:30`,
    );
    const words = `${later.toLocaleDateString("en-GB", { weekday: "long" })} ${later.getDate()} ${later.toLocaleDateString("en-GB", { month: "long" })} at 10:30`;
    await expect(picker.getByText(`Goes ${words}`, { exact: false })).toBeVisible();
    await picker.getByRole("button", { name: "Schedule send" }).click();
    await expect(page.getByText(`Scheduled for ${words}`)).toBeVisible({ timeout: 15_000 });

    // Listed first, waiting, with Cancel.
    const sends = page.getByRole("region", { name: "Sends" }).getByRole("listitem");
    const waiting = sends.first();
    await expect(waiting).toContainText(subject);
    await expect(waiting).toContainText("Scheduled");
    await expect(waiting).toContainText(`goes ${words}`);
    await waiting.getByRole("button", { name: `Cancel ${subject}` }).click();
    await expect(page.getByText("Send cancelled")).toBeVisible();
    const cancelled = sends.filter({ hasText: subject });
    await expect(cancelled).toContainText("Cancelled");
    await expect(cancelled.getByRole("button", { name: /^Cancel/ })).toHaveCount(0);
    const [row] = await queryRows<{ status: string; sent: number }>(
      page,
      "SELECT status, sent FROM newsletter_sends WHERE subject = ?",
      [subject],
    );
    expect(row).toEqual({ status: "cancelled", sent: 0 });
  });

  test("an unsubscribe link with a bad token says so", async ({ page }) => {
    await page.goto("/unsubscribe?t=nope.nope");
    await expect(page.getByRole("heading", { name: "This link is not valid" })).toBeVisible();
  });
});
