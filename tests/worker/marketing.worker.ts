import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import type { CurrentUser, JsonValue, MarketingState } from "../../src/shared/types";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../../src/worker/marketing";
import { beginSend, finishSend, sendNextBatch, sendTime } from "../../src/worker/newsletter-send";
import {
  adminCookie,
  captureBatches,
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  overrideEnv,
  overriding,
  type Posted,
} from "./support";

beforeEach(applyTestMigrations);
afterEach(() => reset());

const json = (cookie: string, method: string, path: string, body?: JsonValue) => {
  const init: RequestInit = { method, headers: { cookie, "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetchWorker(new Request(`http://localhost${path}`, init));
};

const put = (cookie: string, body: JsonValue) => json(cookie, "PUT", "/api/user/marketing", body);

interface ConsentRow {
  news: number | null;
  newsSource: string | null;
  offers: number | null;
  offersSource: string | null;
  asked: number | null;
}

async function consentRow(id: string) {
  return env.DB.prepare(
    `select news_opt_in_at as news, news_opt_in_source as newsSource,
            offers_opt_in_at as offers, offers_opt_in_source as offersSource,
            marketing_asked_at as asked from user where id = ?`,
  )
    .bind(id)
    .first<ConsentRow>();
}

describe("the consent endpoint", () => {
  it("starts everyone not opted in to either list and not asked", async () => {
    const cookie = await freeOwnerCookie();
    const me = await jsonBody<CurrentUser>(await json(cookie, "GET", "/api/user"));
    expect(me.user.marketing).toEqual({ news: false, offers: false, asked: false });
    expect(await consentRow("free-1")).toEqual({
      news: null,
      newsSource: null,
      offers: null,
      offersSource: null,
      asked: null,
    });
  });

  it("requires a session and a well-formed answer", async () => {
    expect(
      (
        await fetchWorker(
          new Request("http://localhost/api/user/marketing", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ news: true, source: "onboarding" }),
          }),
        )
      ).status,
    ).toBe(401);
    const cookie = await freeOwnerCookie();
    expect((await put(cookie, { news: "yes", source: "onboarding" })).status).toBe(400);
    expect((await put(cookie, { news: true, source: "email" })).status).toBe(400);
    // An answer about neither list is not an answer.
    expect((await put(cookie, { source: "settings" })).status).toBe(400);
    expect((await consentRow("free-1"))?.asked).toBeNull();
  });

  it("records each list's own time and source", async () => {
    const cookie = await freeOwnerCookie();
    const before = Date.now();
    const res = await put(cookie, { source: "onboarding", news: false, offers: true });
    expect(await jsonBody<MarketingState>(res)).toEqual({
      news: false,
      offers: true,
      asked: true,
    });
    const row = await consentRow("free-1");
    expect(row).toMatchObject({ news: null, newsSource: "onboarding", offersSource: "onboarding" });
    expect(row?.offers).toBeGreaterThanOrEqual(before);
    expect(row?.asked).toBe(row?.offers);
  });

  it("takes a dismissal as a no to both and as answered", async () => {
    const cookie = await freeOwnerCookie();
    await put(cookie, { source: "prompt", news: false, offers: false });
    const row = await consentRow("free-1");
    expect(row).toMatchObject({
      news: null,
      newsSource: "prompt",
      offers: null,
      offersSource: "prompt",
    });
    expect(row?.asked).not.toBeNull();
  });

  it("ignores an onboarding or dialog answer once the account has answered, but not Settings", async () => {
    const cookie = await freeOwnerCookie();
    await put(cookie, { source: "settings", news: true });
    // A stale onboarding answer touches neither list, even the one Settings left alone.
    const stale = await put(cookie, { source: "onboarding", news: false, offers: true });
    expect(await jsonBody<MarketingState>(stale)).toEqual({
      news: true,
      offers: false,
      asked: true,
    });
    expect(await consentRow("free-1")).toMatchObject({
      newsSource: "settings",
      offersSource: null,
    });
    const off = await put(cookie, { source: "settings", news: false });
    expect(await jsonBody<MarketingState>(off)).toEqual({
      news: false,
      offers: false,
      asked: true,
    });
  });

  it("changes only the list a Settings answer names", async () => {
    const cookie = await freeOwnerCookie();
    await put(cookie, { source: "prompt", news: true, offers: true });
    const res = await put(cookie, { source: "settings", offers: false });
    expect(await jsonBody<MarketingState>(res)).toEqual({ news: true, offers: false, asked: true });
    expect(await consentRow("free-1")).toMatchObject({
      newsSource: "prompt",
      offers: null,
      offersSource: "settings",
    });
  });
});

describe("the unsubscribe token", () => {
  it("names the user and the list it was signed for", async () => {
    for (const list of ["news", "offers"] as const) {
      const token = await signUnsubscribeToken(authEnv(), "user-42", list);
      expect(await verifyUnsubscribeToken(authEnv(), token)).toEqual({ userId: "user-42", list });
    }
  });

  it("rejects a tampered, foreign or malformed token", async () => {
    const token = await signUnsubscribeToken(authEnv(), "user-42", "offers");
    const [, mac] = token.split(".");
    const forged = `${btoa("offers:user-43").replace(/=+$/, "")}.${mac}`;
    expect(await verifyUnsubscribeToken(authEnv(), forged)).toBeNull();
    // The same user, the other list: the list is signed too.
    const otherList = `${btoa("news:user-42").replace(/=+$/, "")}.${mac}`;
    expect(await verifyUnsubscribeToken(authEnv(), otherList)).toBeNull();
    expect(await verifyUnsubscribeToken(authEnv(), `${token}x`)).toBeNull();
    expect(await verifyUnsubscribeToken(authEnv(), token.split(".")[0])).toBeNull();
    expect(await verifyUnsubscribeToken(authEnv(), "")).toBeNull();
    expect(await verifyUnsubscribeToken(authEnv(), undefined)).toBeNull();
    expect(await verifyUnsubscribeToken(authEnv(), "not.a.token")).toBeNull();
    // A token from another deployment's secret.
    const other = overrideEnv({ BETTER_AUTH_SECRET: "another-secret" });
    expect(await verifyUnsubscribeToken(other, token)).toBeNull();
  });
});

/** A user opted in to news at `news` and to offers at `offers` (null: not). */
const seedUser = (id: string, news: number | null, extra = "", offers: number | null = null) =>
  env.DB.prepare(
    `insert into user (id, name, email, email_verified, banned, news_opt_in_at, news_opt_in_source,
       offers_opt_in_at, offers_opt_in_source, created_at, updated_at)
     values (?, ?, ?, ${extra || "1, 0"}, ?, ?, ?, ?, 0, 0)`,
  ).bind(
    id,
    id,
    `${id}@example.com`,
    news,
    news === null ? null : "settings",
    offers,
    offers === null ? null : "prompt",
  );

describe("the unsubscribe page", () => {
  const visit = (token: string, method = "GET", body?: string, query = "") => {
    const init: RequestInit = { method };
    if (body) {
      init.headers = { "content-type": "application/x-www-form-urlencoded" };
      init.body = body;
    }
    return fetchWorker(
      new Request(`http://localhost/unsubscribe?t=${encodeURIComponent(token)}${query}`, init),
    );
  };

  /** The form as the page posts it: the button pressed and the ticked boxes. */
  const form = (action: string, ...ticked: string[]) =>
    new URLSearchParams([["action", action], ...ticked.map((list) => [list, "on"])]).toString();

  it("shows each list ticked as the reader stands, the email's list first, and GET changes nothing", async () => {
    await seedUser("reader-1", null, "", 7).run();
    const token = await signUnsubscribeToken(authEnv(), "reader-1", "offers");
    const res = await visit(token);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Which emails do you want from rdyrct?");
    expect(html).toContain('name="offers" value="on" checked');
    expect(html).toContain('name="news" value="on">');
    expect(html.indexOf('name="offers"')).toBeLessThan(html.indexOf('name="news"'));
    expect(html).toContain('value="save">Save<');
    expect(html).toContain('value="all" class="quiet">Unsubscribe from all<');
    // Fetched twice, as a link preview would: nothing moves.
    await visit(token);
    expect(await consentRow("reader-1")).toMatchObject({ news: null, offers: 7, asked: null });
    const news = await (
      await visit(await signUnsubscribeToken(authEnv(), "reader-1", "news"))
    ).text();
    expect(news.indexOf('name="news"')).toBeLessThan(news.indexOf('name="offers"'));
  });

  it("saves each combination from the form, as a Settings answer", async () => {
    const cases = [
      { ticked: ["news", "offers"], said: "You get product news and offers." },
      { ticked: ["news"], said: "You get product news only." },
      { ticked: ["offers"], said: "You get offers only." },
      { ticked: [], said: "You will not get any rdyrct email." },
    ];
    for (const [i, { ticked, said }] of cases.entries()) {
      const id = `reader-${i}`;
      await seedUser(id, 5).run();
      await env.DB.prepare("update user set marketing_asked_at = 3 where id = ?").bind(id).run();
      const token = await signUnsubscribeToken(authEnv(), id, "news");
      const res = await visit(token, "POST", form("save", ...ticked));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(said);
      const row = await consentRow(id);
      // A list left on keeps its first opt-in; a changed one is a Settings answer.
      expect(row?.news === null).toBe(!ticked.includes("news"));
      expect(row?.offers === null).toBe(!ticked.includes("offers"));
      if (ticked.includes("news")) expect(row).toMatchObject({ news: 5, newsSource: "settings" });
      if (ticked.includes("offers")) expect(row?.offersSource).toBe("settings");
      else expect(row?.offersSource).toBeNull();
      // Asked stays the first time they answered.
      expect(row?.asked).toBe(3);
    }
  });

  it("takes the reader off both lists from Unsubscribe from all, whatever is ticked", async () => {
    await seedUser("reader-1", 5, "", 7).run();
    const token = await signUnsubscribeToken(authEnv(), "reader-1", "news");
    const res = await visit(token, "POST", form("all", "news", "offers"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("You are unsubscribed");
    expect(html).toContain("You will not get any rdyrct email.");
    expect(await consentRow("reader-1")).toMatchObject({ news: null, offers: null });
    // The query form an older page posted still works.
    await env.DB.prepare("update user set news_opt_in_at = 5 where id = 'reader-1'").run();
    await visit(token, "POST", undefined, "&scope=all");
    expect(await consentRow("reader-1")).toMatchObject({ news: null, offers: null });
  });

  it("takes a one-click POST off the email's list only, with no session", async () => {
    await seedUser("reader-1", 5, "", 7).run();
    const token = await signUnsubscribeToken(authEnv(), "reader-1", "offers");
    const res = await visit(token, "POST", "List-Unsubscribe=One-Click");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You get product news only.");
    const row = await consentRow("reader-1");
    expect(row).toMatchObject({ news: 5, offers: null });
    expect(row?.asked).not.toBeNull();
    // Again: still 200, still off.
    expect((await visit(token, "POST", "List-Unsubscribe=One-Click")).status).toBe(200);
    expect((await consentRow("reader-1"))?.news).toBe(5);
    // With no body at all, a client that skips it: the same.
    const news = await signUnsubscribeToken(authEnv(), "reader-1", "news");
    expect((await visit(news, "POST")).status).toBe(200);
    expect(await consentRow("reader-1")).toMatchObject({ news: null, offers: null });
  });

  it("refuses a form it does not know, and changes nothing", async () => {
    await seedUser("reader-1", 5, "", 7).run();
    const token = await signUnsubscribeToken(authEnv(), "reader-1", "news");
    expect((await visit(token, "POST", "action=delete")).status).toBe(400);
    expect((await visit(token, "POST", "action=save&news=yes")).status).toBe(400);
    expect(await consentRow("reader-1")).toMatchObject({ news: 5, offers: 7 });
  });

  it("refuses an invalid token and leaves the account alone", async () => {
    await seedUser("reader-1", 5, "", 7).run();
    const forged = `${btoa("news:reader-1").replace(/=+$/, "")}.AAAA`;
    expect((await visit(forged)).status).toBe(400);
    expect((await visit(forged, "POST", "List-Unsubscribe=One-Click")).status).toBe(400);
    expect((await visit(forged, "POST", undefined, "&scope=all")).status).toBe(400);
    expect((await visit(forged, "POST", "action=save")).status).toBe(400);
    expect(await consentRow("reader-1")).toMatchObject({ news: 5, offers: 7 });
  });
});

type Captured = ReturnType<typeof captureBatches>;

/** Every address a send reached, in order, repeats kept. */
const addressesOf = (mail: Captured) => mail.batches.flatMap((b) => b.emails.map((e) => e.to[0]));

/** Checks `n` people got the issue, each exactly once, and returns who. */
function expectEachOnce(mail: Captured, n: number): string[] {
  const everyone = addressesOf(mail);
  expect(everyone).toHaveLength(n);
  expect(new Set(everyone).size).toBe(n);
  return everyone;
}

/** Runs `change` while the first batch is on its way to the provider, as if
 * the database moved under a running send. Returns the restore. */
function duringFirstBatch(change: () => Promise<void>): () => void {
  const original = globalThis.fetch;
  let first = true;
  globalThis.fetch = async (input, init) => {
    if (first && String(input instanceof Request ? input.url : input).endsWith("/emails/batch")) {
      first = false;
      await change();
    }
    return original(input, init);
  };
  return () => (globalThis.fetch = original);
}

/** A paragraph node as the editor sends it. */
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: JsonValue[]) => ({ type: "doc", content });
const issue = {
  list: "news",
  subject: "What is new",
  doc: doc(para("First paragraph."), para("Second paragraph.")),
};
/** A button node as the editor sends it, extra attributes and all. */
const button = (href: string, label = "Read more") => ({
  type: "button",
  attrs: { class: "button", href, alignment: "left" },
  content: [{ type: "text", text: label }],
});

/** What NewsletterSendWorkflow does once its wait is over, step by step:
 * the worker tests stub the binding, so this is the workflow here. */
async function drive(id: string) {
  if ((await sendTime(authEnv(), id)) === null) return;
  const startedAt = await beginSend(authEnv(), id);
  if (startedAt === null) return;
  try {
    while ((await sendNextBatch(authEnv(), id, startedAt)) > 0);
  } catch (error) {
    await finishSend(authEnv(), id, "failed");
    throw error;
  }
  await finishSend(authEnv(), id, "sent");
}

/** A send's row as the workflow leaves it. */
const sendRow = (id: string) =>
  env.DB.prepare("select status, sent, cursor from newsletter_sends where id = ?")
    .bind(id)
    .first<{ status: string; sent: number; cursor: string }>();

/** Send now through the route, then the workflow's steps. */
async function sendNow(cookie: string, body: { sendId: string; [field: string]: JsonValue }) {
  const res = await json(cookie, "POST", "/api/admin/newsletter/send", body);
  if (res.ok) await drive(body.sendId);
  return res;
}

describe("sending a newsletter", () => {
  it("404s for anyone who is not a platform admin", async () => {
    const mail = captureBatches();
    const cookie = await freeOwnerCookie();
    for (const path of ["/api/admin/newsletter", "/api/admin/newsletter/send"]) {
      const isSend = path.endsWith("send");
      const res = await json(
        cookie,
        isSend ? "POST" : "GET",
        path,
        isSend ? { ...issue, sendId: "send-0001" } : undefined,
      );
      expect(res.status).toBe(404);
    }
    expect(mail.batches).toHaveLength(0);
    mail.restore();
  });

  it("reaches only opted-in, verified, unbanned accounts, each with its own unsubscribe", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch([
      seedUser("yes-1", 5),
      seedUser("yes-2", 6),
      seedUser("never", null),
      seedUser("unverified", 5, "0, 0"),
      seedUser("banned", 5, "1, 1"),
    ]);

    const status = await jsonBody<{ optedIn: { news: number }; configured: boolean }>(
      await json(cookie, "GET", "/api/admin/newsletter"),
    );
    expect(status).toMatchObject({ optedIn: { news: 2 }, configured: true });

    const res = await sendNow(cookie, {
      list: "news",
      subject: issue.subject,
      doc: doc(
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Big <news>" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Read " },
            { type: "text", text: "this", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "the changelog",
              marks: [
                { type: "link", attrs: { href: "https://rdyrct.com/changelog", target: "_blank" } },
              ],
            },
          ],
        },
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [para("One")] }],
        },
        { type: "horizontalRule", attrs: { class: "divider" } },
        button("https://rdyrct.com/changelog"),
      ),
      sendId: "send-0001",
    });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ id: "send-0001", status: "sending", scheduledFor: null });
    expect(await sendRow("send-0001")).toMatchObject({ status: "sent", sent: 2 });

    const sent = mail.batches.flatMap((b) => b.emails);
    expect(sent.map((e) => e.to[0]).sort()).toEqual(["yes-1@example.com", "yes-2@example.com"]);
    // The send id and the batch's first recipient: the same on a retry.
    expect(mail.batches[0].key).toBe("send-0001-yes-1");
    for (const email of sent) {
      expect(email.from).toMatch(/<[^>]+>$/);
      expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      const link = email.headers["List-Unsubscribe"].slice(1, -1);
      expect(link).toMatch(/^http:\/\/localhost\/unsubscribe\?t=/);
      expect(email.html).toContain("Unsubscribe");
      expect(email.text).toContain(`Unsubscribe: ${link}`);
      expect(email.text).toContain(
        "You get this because you opted in to product news from rdyrct.",
      );
      expect(email.html).toContain("Read more");
      expect(email.html).toContain("<h2");
      expect(email.html).toContain("Big &lt;news&gt;");
      expect(email.html).toContain("<strong>this</strong>");
      expect(email.html).toContain('href="https://rdyrct.com/changelog"');
      expect(email.text).toContain("Big <news>");
      expect(email.text).toContain("Read this and the changelog (https://rdyrct.com/changelog)");
      expect(email.text).toContain("- One");
      expect(email.text).toContain("Read more: https://rdyrct.com/changelog");
    }
    // Each person's link names that person, and only works for them.
    const [first, second] = sent;
    expect(first.headers["List-Unsubscribe"]).not.toBe(second.headers["List-Unsubscribe"]);
    const token = new URL(first.headers["List-Unsubscribe"].slice(1, -1)).searchParams.get("t");
    const owner = await verifyUnsubscribeToken(authEnv(), token ?? "");
    expect(owner?.list).toBe("news");
    expect(owner && first.to[0].startsWith(owner.userId)).toBe(true);
    mail.restore();
  });

  it("counts every answer and keeps one history row per issue, however often it is retried", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch([
      seedUser("yes-1", 5),
      seedUser("unverified", 5, "0, 0"),
      seedUser("never", null),
      env.DB.prepare(
        `insert into user (id, name, email, email_verified, banned, marketing_asked_at, created_at, updated_at)
         values ('said-no', 'said-no', 'said-no@example.com', 1, 0, 5, 0, 0)`,
      ),
    ]);
    type Answers = { yes: Record<string, number>; no: number; unasked: number };
    type Status = {
      optedIn: { news: number; offers: number };
      answers: { news: Answers; offers: Answers };
      sends: { id: string; list: string; subject: string; sent: number; sentBy: string | null }[];
    };
    const status = async () => jsonBody<Status>(await json(cookie, "GET", "/api/admin/newsletter"));

    const before = await status();
    // The unverified yes counts as a yes, but gets no send.
    expect(before.optedIn).toEqual({ news: 1, offers: 0 });
    expect(before.answers.news.yes).toEqual({ onboarding: 0, prompt: 0, settings: 2 });
    expect(before.answers.news.no).toBe(1);
    expect(before.answers.news.unasked).toBeGreaterThanOrEqual(1);
    expect(before.answers.offers.yes).toEqual({ onboarding: 0, prompt: 0, settings: 0 });
    // Asked once covers both lists: the no to news is a no to offers too.
    expect(before.answers.offers.no).toBe(1);
    expect(before.sends).toEqual([]);

    // A test send is not history.
    await json(cookie, "POST", "/api/admin/newsletter/test", issue);
    expect((await status()).sends).toEqual([]);

    for (let i = 0; i < 2; i++) {
      const res = await sendNow(cookie, { ...issue, sendId: "send-history" });
      expect(res.status).toBe(200);
    }
    // The retry of a finished send posts nothing: one batch for this send.
    expect(mail.batches.filter((b) => b.key?.startsWith("send-history-"))).toHaveLength(1);
    const after = await status();
    expect(after.sends).toHaveLength(1);
    expect(after.sends[0]).toMatchObject({
      id: "send-history",
      list: "news",
      subject: issue.subject,
      status: "sent",
      sent: 1,
      scheduledFor: null,
    });
    expect(after.sends[0].sentBy).toMatch(/@/);

    const users = await jsonBody<{ email: string; news: string; offers: string }[]>(
      await json(cookie, "GET", "/api/admin/users"),
    );
    const answers = Object.fromEntries(users.map((u) => [u.email, [u.news, u.offers]]));
    expect(answers).toMatchObject({
      "yes-1@example.com": ["on", "unasked"],
      "said-no@example.com": ["off", "off"],
      "never@example.com": ["unasked", "unasked"],
    });
    mail.restore();
  });

  it("sends a test to the admin alone", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch([seedUser("yes-1", 5)]);
    const res = await json(cookie, "POST", "/api/admin/newsletter/test", issue);
    expect(res.status).toBe(200);
    const sent = mail.batches.flatMap((b) => b.emails);
    expect(sent.map((e) => e.to)).toEqual([["admin@example.com"]]);
    expect(sent[0].headers["List-Unsubscribe"]).toBeTruthy();
    mail.restore();
  });

  it("is refused with a clear error when NEWSLETTER_FROM is not set", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch([seedUser("yes-1", 5)]);
    const unset = overrideEnv({ ...authEnv(), NEWSLETTER_FROM: undefined });
    const res = await fetchWorker(
      new Request("http://localhost/api/admin/newsletter/send", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ...issue, sendId: "send-0002" }),
      }),
      unset,
    );
    expect(res.status).toBe(409);
    expect((await jsonBody<{ message: string }>(res)).message).toContain("not set up");
    expect(mail.batches).toHaveLength(0);
    mail.restore();
  });

  it("rejects a send with no subject, no text, or a button with no link", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    const send = async (body: { [field: string]: JsonValue }) => {
      const res = await json(cookie, "POST", "/api/admin/newsletter/send", {
        sendId: "send-0003",
        ...body,
      });
      return { status: res.status, message: (await jsonBody<{ message: string }>(res)).message };
    };
    expect((await send({ ...issue, subject: " " })).status).toBe(400);
    expect(await send({ ...issue, doc: doc({ type: "paragraph" }) })).toEqual({
      status: 400,
      message: "Write the email",
    });
    expect((await send({ ...issue, body: "Plain text", doc: null })).status).toBe(400);
    for (const href of ["#", "javascript:alert(1)"]) {
      expect(await send({ ...issue, doc: doc(para("Hi"), button(href)) })).toEqual({
        status: 400,
        message: "A button needs a label and an http(s) link",
      });
    }
    expect(mail.batches).toHaveLength(0);
    mail.restore();
  });

  it("accepts a document on the test route and refuses a node the editor does not have", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    const test = (body: JsonValue) => json(cookie, "POST", "/api/admin/newsletter/test", body);
    expect((await test(issue)).status).toBe(200);

    const table = { type: "table", content: [{ type: "tableRow", content: [] }] };
    const image = { type: "image", attrs: { src: "https://evil.test/x.png" } };
    for (const node of [table, image]) {
      const res = await test({ ...issue, doc: doc(para("Hi"), node) });
      expect(res.status).toBe(400);
      expect((await jsonBody<{ message: string }>(res)).message).toContain(`"${node.type}"`);
    }
    // A mark outside the list, and a list nested past the cap, inside a list item.
    const strike = { type: "text", text: "x", marks: [{ type: "strike" }] };
    expect(
      (await test({ ...issue, doc: doc({ type: "paragraph", content: [strike] }) })).status,
    ).toBe(400);
    let nested: JsonValue = para("deep");
    for (let i = 0; i < 6; i++) {
      nested = {
        type: "bulletList",
        content: [{ type: "listItem", content: [para("x"), nested] }],
      };
    }
    expect((await test({ ...issue, doc: doc(nested) })).status).toBe(400);
    // Only the first, valid test went out.
    expect(mail.batches).toHaveLength(1);
    mail.restore();
  });

  it("refuses a send nobody would get, and keeps no history for it", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch([seedUser("never", null)]);
    const res = await json(cookie, "POST", "/api/admin/newsletter/send", {
      ...issue,
      sendId: "send-empty",
    });
    expect(res.status).toBe(409);
    expect(mail.batches).toHaveLength(0);
    const rows = await env.DB.prepare("select count(*) as n from newsletter_sends").first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
    mail.restore();
  });

  it("retries a failed batch from where it stopped, and nobody gets it twice", async () => {
    // 150 people: two batches. The second batch fails the first time.
    let failed = false;
    const mail = captureBatches((call) => (call === 1 && !failed ? ((failed = true), 500) : 200));
    const cookie = await adminCookie();
    await env.DB.batch(
      Array.from({ length: 150 }, (_, i) => seedUser(`p${String(i).padStart(3, "0")}`, 5)),
    );
    const res = await json(cookie, "POST", "/api/admin/newsletter/send", {
      ...issue,
      sendId: "send-resume",
    });
    expect(res.status).toBe(200);
    // The workflow's steps, the second batch failing once and retried.
    const startedAt = (await beginSend(authEnv(), "send-resume"))!;
    expect(await sendNextBatch(authEnv(), "send-resume", startedAt)).toBe(100);
    await expect(sendNextBatch(authEnv(), "send-resume", startedAt)).rejects.toThrow();
    expect(await sendRow("send-resume")).toMatchObject({
      status: "sending",
      sent: 100,
      cursor: "p099",
    });
    expect(await sendNextBatch(authEnv(), "send-resume", startedAt)).toBe(50);
    expect(await sendNextBatch(authEnv(), "send-resume", startedAt)).toBe(0);
    await finishSend(authEnv(), "send-resume", "sent");
    expectEachOnce(mail, 150);

    // Sent: the same send id again starts nothing and sends nothing more.
    const again = await sendNow(cookie, { ...issue, sendId: "send-resume" });
    expect(await jsonBody(again)).toMatchObject({ status: "sent" });
    expect(mail.batches.flatMap((b) => b.emails)).toHaveLength(150);
    expect(await sendRow("send-resume")).toMatchObject({ status: "sent", sent: 150 });
    mail.restore();
  });

  it("leaves out somebody who unsubscribed while the send was running", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch(
      Array.from({ length: 101 }, (_, i) => seedUser(`q${String(i).padStart(3, "0")}`, 5)),
    );
    // The last person unsubscribes as the first batch goes out.
    const restoreFetch = duringFirstBatch(async () => {
      await env.DB.prepare("update user set news_opt_in_at = null where id = 'q100'").run();
    });
    await sendNow(cookie, { ...issue, sendId: "send-unsub" });
    restoreFetch();
    expect(await sendRow("send-unsub")).toMatchObject({ status: "sent", sent: 100 });
    expect(mail.batches.flatMap((b) => b.emails.map((e) => e.to[0]))).not.toContain(
      "q100@example.com",
    );
    mail.restore();
  });

  it("counts a batch the provider already has under its key as sent", async () => {
    const mail = captureBatches(() => 409);
    const cookie = await adminCookie();
    await env.DB.batch([seedUser("yes-1", 5)]);
    await sendNow(cookie, { ...issue, sendId: "send-replay" });
    expect(await sendRow("send-replay")).toMatchObject({ status: "sent", sent: 1 });
    mail.restore();
  });

  it("ends a send whose batch fails every retry as failed, with what went counted", async () => {
    const mail = captureBatches(() => 500);
    const cookie = await adminCookie();
    await env.DB.batch([seedUser("yes-1", 5)]);
    await expect(sendNow(cookie, { ...issue, sendId: "send-0004" })).rejects.toThrow();
    expect(await sendRow("send-0004")).toMatchObject({ status: "failed", sent: 0 });
    mail.restore();
  });

  it("marks a send failed when its workflow cannot start", async () => {
    const cookie = await adminCookie();
    await env.DB.batch([seedUser("yes-1", 5)]);
    const refusing = overrideEnv({
      ...authEnv(),
      NEWSLETTER_SEND: overriding(authEnv().NEWSLETTER_SEND, {
        get: () => Promise.reject(new Error("not found")),
        create: () => Promise.reject(new Error("injected workflow start failure")),
      }),
    });
    const res = await fetchWorker(
      new Request("http://localhost/api/admin/newsletter/send", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ...issue, sendId: "send-nostart" }),
      }),
      refusing,
    );
    expect(res.status).toBe(502);
    expect(await sendRow("send-nostart")).toMatchObject({ status: "failed", sent: 0 });
  });
});

describe("sending to one list", () => {
  it("reaches only people opted in to that list, with that list's link and footer", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch([
      seedUser("news-only", 5),
      seedUser("offers-only", null, "", 6),
      seedUser("both", 5, "", 6),
    ]);
    const status = await jsonBody<{ optedIn: { news: number; offers: number } }>(
      await json(cookie, "GET", "/api/admin/newsletter"),
    );
    expect(status.optedIn).toEqual({ news: 2, offers: 2 });

    await sendNow(cookie, { ...issue, list: "offers", sendId: "send-offers" });
    expect(await sendRow("send-offers")).toMatchObject({ status: "sent", sent: 2 });
    expect(addressesOf(mail).sort()).toEqual(["both@example.com", "offers-only@example.com"]);
    const sent = mail.batches.flatMap((b) => b.emails);
    for (const email of sent) {
      expect(email.text).toContain("You get this because you opted in to offers from rdyrct.");
      const link = new URL(email.headers["List-Unsubscribe"].slice(1, -1));
      const named = await verifyUnsubscribeToken(authEnv(), link.searchParams.get("t") ?? "");
      expect(named?.list).toBe("offers");
    }
    const history = await jsonBody<{ sends: { id: string; list: string }[] }>(
      await json(cookie, "GET", "/api/admin/newsletter"),
    );
    expect(history.sends).toEqual([expect.objectContaining({ id: "send-offers", list: "offers" })]);
    mail.restore();
  });

  it("refuses a list nobody is opted in to, and a send id carried to the other list", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch([seedUser("news-only", 5)]);
    const send = (list: string, sendId: string) => sendNow(cookie, { ...issue, list, sendId });
    expect((await send("offers", "send-nobody")).status).toBe(409);
    expect((await send("news", "send-mixed")).status).toBe(200);
    expect((await send("offers", "send-mixed")).status).toBe(409);
    expect((await send("everyone", "send-other")).status).toBe(400);
    expect(mail.batches.flatMap((b) => b.emails)).toHaveLength(1);
    mail.restore();
  });
});

describe("narrowing a send", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const org = () =>
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-a', 'A', 0)");
  /** One link, made by `userId`. */
  const linkBy = (userId: string) =>
    env.DB.prepare(
      "insert into links (id, org_id, slug, destination, created_at, created_by) values (?, 'org-a', ?, 'https://example.com', 0, ?)",
    ).bind(`link-${userId}`, `s-${userId}`, userId);
  /** An offers reader on `plan`, last seen `seenDaysAgo` days back (null: never). */
  const reader = (id: string, plan: string, seenDaysAgo: number | null) => [
    seedUser(id, null, "", 5),
    env.DB.prepare("update user set plan = ?, last_seen_at = ? where id = ?").bind(
      plan,
      seenDaysAgo === null ? null : Date.now() - seenDaysAgo * DAY,
      id,
    ),
  ];
  const count = async (cookie: string, query: string) => {
    const res = await json(cookie, "GET", `/api/admin/newsletter/audience?list=offers&${query}`);
    expect(res.status).toBe(200);
    return (await jsonBody<{ count: number }>(res)).count;
  };

  async function seedStages() {
    await env.DB.batch([
      org(),
      ...reader("fresh-free", "free", 1),
      ...reader("fresh-paid", "hobby", 1),
      ...reader("active-free", "free", 1),
      // Seen through a session only: last_seen_at has not caught up.
      ...reader("active-pro", "pro", null),
      env.DB.prepare(
        "insert into session (id, token, user_id, expires_at, created_at, updated_at) values ('s1', 't1', 'active-pro', ?, 0, ?)",
      ).bind(Date.now() + DAY, Date.now() - 2 * DAY),
      ...reader("slipping-free", "free", 40),
      ...reader("slipping-never", "pro", null),
      ...["active-free", "active-pro", "slipping-free", "slipping-never"].map(linkBy),
      // On news only: no filter brings them into an offers send.
      seedUser("news-only", 5),
    ]);
  }

  it("counts each stage and plan, and every pair of them", async () => {
    const cookie = await adminCookie();
    await seedStages();
    expect(await count(cookie, "")).toBe(6);
    expect(await count(cookie, "stage=new")).toBe(2);
    expect(await count(cookie, "stage=active")).toBe(2);
    expect(await count(cookie, "stage=slipping")).toBe(2);
    expect(await count(cookie, "plan=free")).toBe(3);
    expect(await count(cookie, "plan=paid")).toBe(3);
    expect(await count(cookie, "stage=new&plan=free")).toBe(1);
    expect(await count(cookie, "stage=active&plan=paid")).toBe(1);
    expect(await count(cookie, "stage=slipping&plan=free")).toBe(1);
    expect(await count(cookie, "stage=any&plan=any")).toBe(6);
    const bad = await json(cookie, "GET", "/api/admin/newsletter/audience?list=offers&stage=old");
    expect(bad.status).toBe(400);
  });

  it("sends only to the people the filters pick, and keeps the filters on the row", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await seedStages();
    const send = async (audience: JsonValue, sendId: string) => {
      const res = await sendNow(cookie, { ...issue, list: "offers", sendId, audience });
      expect(res.status).toBe(200);
      return mail.batches.flatMap((b) => (b.key?.startsWith(sendId) ? b.emails : []));
    };
    const to = (emails: Posted[]) => emails.map((e) => e.to[0].split("@")[0]).sort();
    expect(to(await send({ stage: "new", plan: "free" }, "send-new-free"))).toEqual(["fresh-free"]);
    expect(to(await send({ stage: "active" }, "send-active"))).toEqual([
      "active-free",
      "active-pro",
    ]);
    expect(to(await send({ stage: "slipping", plan: "paid" }, "send-slip-paid"))).toEqual([
      "slipping-never",
    ]);
    expect(to(await send({ plan: "paid" }, "send-paid"))).toEqual([
      "active-pro",
      "fresh-paid",
      "slipping-never",
    ]);
    const history = await jsonBody<{ sends: { id: string; audience: JsonValue }[] }>(
      await json(cookie, "GET", "/api/admin/newsletter"),
    );
    expect(history.sends.find((s) => s.id === "send-new-free")?.audience).toEqual({
      stage: "new",
      plan: "free",
    });
    expect(history.sends.find((s) => s.id === "send-paid")?.audience).toEqual({
      stage: "any",
      plan: "paid",
    });
    // Filters nobody matches: refused, as an empty list is.
    const none = await json(cookie, "POST", "/api/admin/newsletter/send", {
      ...issue,
      list: "news",
      sendId: "send-none",
      audience: { stage: "active" },
    });
    expect(none.status).toBe(409);
    mail.restore();
  });

  it("keeps the filters for every batch, and refuses other filters on the same send", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    // 150 people with no link and 150 with one, ids interleaved.
    const ids = Array.from({ length: 150 }, (_, i) => String(i).padStart(3, "0"));
    await env.DB.batch([
      org(),
      ...ids.flatMap((i) => [seedUser(`p${i}-a-new`, 5), seedUser(`p${i}-b-link`, 5)]),
      ...ids.map((i) => linkBy(`p${i}-b-link`)),
    ]);
    const send = (audience: JsonValue) =>
      json(cookie, "POST", "/api/admin/newsletter/send", {
        ...issue,
        sendId: "send-resume-new",
        audience,
      });
    expect((await send({ stage: "new" })).status).toBe(200);
    const stored = await env.DB.prepare(
      "select audience from newsletter_sends where id = 'send-resume-new'",
    ).first<{ audience: string }>();
    expect(JSON.parse(stored?.audience ?? "")).toEqual({ stage: "new", plan: "any" });

    // The same send with other filters would mix two audiences.
    expect((await send({ stage: "active" })).status).toBe(409);
    expect((await send({})).status).toBe(409);
    // The same filters again is a retry: it answers the send as it stands.
    expect((await send({ stage: "new" })).status).toBe(200);

    await drive("send-resume-new");
    expect(await sendRow("send-resume-new")).toMatchObject({ status: "sent", sent: 150 });
    const everyone = expectEachOnce(mail, 150);
    expect(everyone.every((address) => address.includes("-a-new@"))).toBe(true);
    mail.restore();
  });

  it("leaves out somebody who leaves the filter while the send runs", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch([
      org(),
      ...Array.from({ length: 101 }, (_, i) => seedUser(`r${String(i).padStart(3, "0")}`, 5)),
    ]);
    // The last person makes a link as the first batch goes out: no longer new.
    const restoreFetch = duringFirstBatch(async () => {
      await linkBy("r100").run();
    });
    await sendNow(cookie, { ...issue, sendId: "send-leaves", audience: { stage: "new" } });
    restoreFetch();
    expect(await sendRow("send-leaves")).toMatchObject({ status: "sent", sent: 100 });
    mail.restore();
  });
});
