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
function captureBatches(status = 200) {
  const batches: { key: string | null; emails: Posted[] }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.endsWith("/emails/batch")) return original(input, init);
    const headers = new Headers(init?.headers);
    // SAFETY: the only sender of this request is deliverNewsletter(), which
    // posts an array of exactly these fields.
    const emails = JSON.parse(String(init?.body ?? "[]")) as Posted[];
    batches.push({ key: headers.get("idempotency-key"), emails });
    return status === 200
      ? Response.json({ data: emails.map((_, i) => ({ id: `m${i}` })) })
      : new Response("down", { status });
  };
  return { batches, restore: () => (globalThis.fetch = original) };
}

const issue = { subject: "What is new", body: "First paragraph.\n\nSecond paragraph." };

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
      ...issue,
      ctaLabel: "Read more",
      ctaUrl: "https://rdyrct.com/changelog",
      sendId: "send-0001",
    });
    expect(res.status).toBe(200);
    expect(await jsonBody<{ sent: number }>(res)).toEqual({ sent: 2 });

    const sent = mail.batches.flatMap((b) => b.emails);
    expect(sent.map((e) => e.to[0]).sort()).toEqual(["yes-1@example.com", "yes-2@example.com"]);
    expect(mail.batches[0].key).toBe("send-0001-0");
    for (const email of sent) {
      expect(email.from).toMatch(/<[^>]+>$/);
      expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      const link = email.headers["List-Unsubscribe"].slice(1, -1);
      expect(link).toMatch(/^http:\/\/localhost\/unsubscribe\?t=/);
      expect(email.html).toContain("Unsubscribe");
      expect(email.text).toContain(`Unsubscribe: ${link}`);
      expect(email.html).toContain("Read more");
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

  it("rejects a send with no subject, and a button with no link", async () => {
    const cookie = await adminCookie();
    const send = (body: { [field: string]: string }) =>
      json(cookie, "POST", "/api/admin/newsletter/send", { sendId: "send-0003", ...body });
    expect((await send({ subject: " ", body: "Hi" })).status).toBe(400);
    expect((await send({ ...issue, ctaLabel: "Go" })).status).toBe(400);
    expect((await send({ ...issue, ctaLabel: "Go", ctaUrl: "javascript:alert(1)" })).status).toBe(
      400,
    );
  });

  it("answers a provider failure with an error, not a success", async () => {
    const mail = captureBatches(500);
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
