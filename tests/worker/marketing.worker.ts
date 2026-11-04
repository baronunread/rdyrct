import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import type { CurrentUser, JsonValue, MarketingState } from "../../src/shared/types";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../../src/worker/marketing";
import {
  adminCookie,
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  overrideEnv,
} from "./support";

beforeEach(applyTestMigrations);
afterEach(() => reset());

const json = (cookie: string, method: string, path: string, body?: JsonValue) => {
  const init: RequestInit = { method, headers: { cookie, "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetchWorker(new Request(`http://localhost${path}`, init));
};

const put = (cookie: string, body: JsonValue) => json(cookie, "PUT", "/api/user/marketing", body);

async function consentRow(id: string) {
  return env.DB.prepare(
    "select marketing_opt_in_at as at, marketing_opt_in_source as source, marketing_asked_at as asked from user where id = ?",
  )
    .bind(id)
    .first<{ at: number | null; source: string | null; asked: number | null }>();
}

describe("the consent endpoint", () => {
  it("starts everyone not opted in and not asked", async () => {
    const cookie = await freeOwnerCookie();
    const me = await jsonBody<CurrentUser>(await json(cookie, "GET", "/api/user"));
    expect(me.user.marketing).toEqual({ optedIn: false, asked: false });
    expect(await consentRow("free-1")).toEqual({ at: null, source: null, asked: null });
  });

  it("requires a session and a well-formed answer", async () => {
    expect(
      (
        await fetchWorker(
          new Request("http://localhost/api/user/marketing", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ optIn: true, source: "signup" }),
          }),
        )
      ).status,
    ).toBe(401);
    const cookie = await freeOwnerCookie();
    expect((await put(cookie, { optIn: "yes", source: "signup" })).status).toBe(400);
    expect((await put(cookie, { optIn: true, source: "email" })).status).toBe(400);
    expect((await consentRow("free-1"))?.asked).toBeNull();
  });

  it("records when and where an opt-in came from", async () => {
    const cookie = await freeOwnerCookie();
    const before = Date.now();
    const res = await put(cookie, { optIn: true, source: "signup" });
    expect(await jsonBody<MarketingState>(res)).toEqual({ optedIn: true, asked: true });
    const row = await consentRow("free-1");
    expect(row?.source).toBe("signup");
    expect(row?.at).toBeGreaterThanOrEqual(before);
    expect(row?.asked).toBe(row?.at);
  });

  it("takes a dismissal as a no and as answered", async () => {
    const cookie = await freeOwnerCookie();
    await put(cookie, { optIn: false, source: "prompt" });
    const row = await consentRow("free-1");
    expect(row).toMatchObject({ at: null, source: "prompt" });
    expect(row?.asked).not.toBeNull();
  });

  it("ignores a sign-up or dialog answer once the account has answered, but not Settings", async () => {
    const cookie = await freeOwnerCookie();
    await put(cookie, { optIn: true, source: "settings" });
    const stale = await put(cookie, { optIn: false, source: "signup" });
    expect(await jsonBody<MarketingState>(stale)).toEqual({ optedIn: true, asked: true });
    expect((await consentRow("free-1"))?.source).toBe("settings");
    const off = await put(cookie, { optIn: false, source: "settings" });
    expect(await jsonBody<MarketingState>(off)).toEqual({ optedIn: false, asked: true });
  });
});

describe("the unsubscribe token", () => {
  it("names the user it was signed for", async () => {
    const token = await signUnsubscribeToken(authEnv(), "user-42");
    expect(await verifyUnsubscribeToken(authEnv(), token)).toBe("user-42");
  });

  it("rejects a tampered, foreign or malformed token", async () => {
    const token = await signUnsubscribeToken(authEnv(), "user-42");
    const [, mac] = token.split(".");
    const forged = `${btoa("user-43").replace(/=+$/, "")}.${mac}`;
    expect(await verifyUnsubscribeToken(authEnv(), forged)).toBeNull();
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

const seedUser = (id: string, at: number | null, extra = "") =>
  env.DB.prepare(
    `insert into user (id, name, email, email_verified, banned, marketing_opt_in_at, marketing_opt_in_source, created_at, updated_at)
     values (?, ?, ?, ${extra || "1, 0"}, ?, ?, 0, 0)`,
  ).bind(id, id, `${id}@example.com`, at, at === null ? null : "settings");

describe("the unsubscribe page", () => {
  const visit = (token: string, method = "GET", body?: string) => {
    const init: RequestInit = { method };
    if (body) {
      init.headers = { "content-type": "application/x-www-form-urlencoded" };
      init.body = body;
    }
    return fetchWorker(
      new Request(`http://localhost/unsubscribe?t=${encodeURIComponent(token)}`, init),
    );
  };

  it("shows a button on GET and changes nothing until the POST", async () => {
    await seedUser("reader-1", 5).run();
    const token = await signUnsubscribeToken(authEnv(), "reader-1");
    const page = await visit(token);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<button");
    expect((await consentRow("reader-1"))?.at).toBe(5);
  });

  it("takes a one-click POST from a mail client, with no session", async () => {
    await seedUser("reader-1", 5).run();
    const token = await signUnsubscribeToken(authEnv(), "reader-1");
    const res = await visit(token, "POST", "List-Unsubscribe=One-Click");
    expect(res.status).toBe(200);
    const row = await consentRow("reader-1");
    expect(row?.at).toBeNull();
    expect(row?.asked).not.toBeNull();
    // Again: still 200, still off.
    expect((await visit(token, "POST", "List-Unsubscribe=One-Click")).status).toBe(200);
  });

  it("refuses an invalid token and leaves the account alone", async () => {
    await seedUser("reader-1", 5).run();
    const forged = `${btoa("reader-1").replace(/=+$/, "")}.AAAA`;
    expect((await visit(forged)).status).toBe(400);
    expect((await visit(forged, "POST", "List-Unsubscribe=One-Click")).status).toBe(400);
    expect((await consentRow("reader-1"))?.at).toBe(5);
  });
});

interface Posted {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** Stands in for the provider's batch endpoint. */
/** Stands in for the provider's batch endpoint. `status` answers each call
 * by its index (from 0), so a test can fail one batch and not the others. */
function captureBatches(status: (call: number) => number = () => 200) {
  const batches: { key: string | null; emails: Posted[] }[] = [];
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.endsWith("/emails/batch")) return original(input, init);
    const headers = new Headers(init?.headers);
    // SAFETY: the only sender of this request is deliverBatch(), which posts
    // an array of exactly these fields.
    const emails = JSON.parse(String(init?.body ?? "[]")) as Posted[];
    const answer = status(calls);
    calls += 1;
    if (answer === 409) {
      return Response.json({ name: "invalid_idempotent_request" }, { status: 409 });
    }
    if (answer !== 200) return new Response("down", { status: answer });
    batches.push({ key: headers.get("idempotency-key"), emails });
    return Response.json({ data: emails.map((_, i) => ({ id: `m${i}` })) });
  };
  return { batches, restore: () => (globalThis.fetch = original) };
}

/** A paragraph node as the editor sends it. */
const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...content: JsonValue[]) => ({ type: "doc", content });
const issue = {
  subject: "What is new",
  doc: doc(para("First paragraph."), para("Second paragraph.")),
};
/** A button node as the editor sends it, extra attributes and all. */
const button = (href: string, label = "Read more") => ({
  type: "button",
  attrs: { class: "button", href, alignment: "left" },
  content: [{ type: "text", text: label }],
});

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

    const status = await jsonBody<{ optedIn: number; configured: boolean }>(
      await json(cookie, "GET", "/api/admin/newsletter"),
    );
    expect(status).toMatchObject({ optedIn: 2, configured: true });

    const res = await json(cookie, "POST", "/api/admin/newsletter/send", {
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
    expect(await jsonBody<{ sent: number }>(res)).toEqual({ sent: 2, done: true });

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
    expect(owner && first.to[0].startsWith(owner)).toBe(true);
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
    type Status = {
      optedIn: number;
      answers: { yes: Record<string, number>; no: number; unasked: number };
      sends: { id: string; subject: string; sent: number; sentBy: string | null }[];
    };
    const status = async () => jsonBody<Status>(await json(cookie, "GET", "/api/admin/newsletter"));

    const before = await status();
    // The unverified yes counts as a yes, but gets no send.
    expect(before.optedIn).toBe(1);
    expect(before.answers.yes).toEqual({ signup: 0, prompt: 0, settings: 2 });
    expect(before.answers.no).toBe(1);
    expect(before.answers.unasked).toBeGreaterThanOrEqual(1);
    expect(before.sends).toEqual([]);

    // A test send is not history.
    await json(cookie, "POST", "/api/admin/newsletter/test", issue);
    expect((await status()).sends).toEqual([]);

    for (let i = 0; i < 2; i++) {
      const res = await json(cookie, "POST", "/api/admin/newsletter/send", {
        ...issue,
        sendId: "send-history",
      });
      expect(res.status).toBe(200);
    }
    // The retry of a finished send posts nothing: one batch for this send.
    expect(mail.batches.filter((b) => b.key?.startsWith("send-history-"))).toHaveLength(1);
    const after = await status();
    expect(after.sends).toHaveLength(1);
    expect(after.sends[0]).toMatchObject({ id: "send-history", subject: issue.subject, sent: 1 });
    expect(after.sends[0].sentBy).toMatch(/@/);

    const users = await jsonBody<{ email: string; news: string }[]>(
      await json(cookie, "GET", "/api/admin/users"),
    );
    const news = Object.fromEntries(users.map((u) => [u.email, u.news]));
    expect(news).toMatchObject({
      "yes-1@example.com": "on",
      "said-no@example.com": "off",
      "never@example.com": "unasked",
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

  it("carries a stopped send on from where it stopped, and nobody gets it twice", async () => {
    // 150 people: two batches. The second batch fails the first time.
    let failed = false;
    const mail = captureBatches((call) => (call === 1 && !failed ? ((failed = true), 500) : 200));
    const cookie = await adminCookie();
    await env.DB.batch(
      Array.from({ length: 150 }, (_, i) => seedUser(`p${String(i).padStart(3, "0")}`, 5)),
    );
    const send = () =>
      json(cookie, "POST", "/api/admin/newsletter/send", { ...issue, sendId: "send-resume" });

    expect((await send()).status).toBe(502);
    const stopped = await env.DB.prepare(
      "select sent, cursor, done from newsletter_sends where id = 'send-resume'",
    ).first<{ sent: number; cursor: string; done: number }>();
    expect(stopped).toMatchObject({ sent: 100, cursor: "p099", done: 0 });

    const res = await send();
    expect(res.status).toBe(200);
    expect(await jsonBody<{ sent: number; done: boolean }>(res)).toEqual({ sent: 150, done: true });
    const everyone = mail.batches.flatMap((b) => b.emails.map((e) => e.to[0]));
    expect(everyone).toHaveLength(150);
    expect(new Set(everyone).size).toBe(150);

    // Done: sending the same issue again sends nothing more.
    expect(await jsonBody<{ sent: number }>(await send())).toEqual({ sent: 150, done: true });
    expect(mail.batches.flatMap((b) => b.emails)).toHaveLength(150);
    mail.restore();
  });

  it("leaves out somebody who unsubscribed while the send was running", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await env.DB.batch(
      Array.from({ length: 101 }, (_, i) => seedUser(`q${String(i).padStart(3, "0")}`, 5)),
    );
    // The last person unsubscribes as the first batch goes out.
    const original = globalThis.fetch;
    let first = true;
    globalThis.fetch = async (input, init) => {
      if (first && String(input instanceof Request ? input.url : input).endsWith("/emails/batch")) {
        first = false;
        await env.DB.prepare("update user set marketing_opt_in_at = null where id = 'q100'").run();
      }
      return original(input, init);
    };
    const res = await json(cookie, "POST", "/api/admin/newsletter/send", {
      ...issue,
      sendId: "send-unsub",
    });
    globalThis.fetch = original;
    expect(await jsonBody<{ sent: number }>(res)).toEqual({ sent: 100, done: true });
    expect(mail.batches.flatMap((b) => b.emails.map((e) => e.to[0]))).not.toContain(
      "q100@example.com",
    );
    mail.restore();
  });

  it("counts a batch the provider already has under its key as sent", async () => {
    const mail = captureBatches(() => 409);
    const cookie = await adminCookie();
    await env.DB.batch([seedUser("yes-1", 5)]);
    const res = await json(cookie, "POST", "/api/admin/newsletter/send", {
      ...issue,
      sendId: "send-replay",
    });
    expect(await jsonBody<{ sent: number; done: boolean }>(res)).toEqual({ sent: 1, done: true });
    mail.restore();
  });

  it("answers a provider failure with an error, not a success", async () => {
    const mail = captureBatches(() => 500);
    const cookie = await adminCookie();
    await env.DB.batch([seedUser("yes-1", 5)]);
    const res = await json(cookie, "POST", "/api/admin/newsletter/send", {
      ...issue,
      sendId: "send-0004",
    });
    expect(res.status).toBe(502);
    mail.restore();
  });
});
