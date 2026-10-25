// fallow-ignore-file code-duplication -- worker specs repeat their setup so each reads on its own
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import { applyStorageMessage, syncLinkMsg } from "../../src/worker/storage";
import { claimAnonLink } from "../../src/worker/routes/shorten";
import {
  adminCookie,
  applyTestMigrations,
  authEnv,
  captureEmails,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  overrideEnv,
  testEnv,
} from "./support";

/**
 * What puts links on hold, and what an admin's abuse decision does (the
 * 2026-10-18 follow-up): a scam-shaped destination is created on hold, a
 * blocked host cannot be linked. Bans have their own spec (ban.worker.ts).
 */

const SCAM = "https://phonepewheel-production.up.railway.app/";

const api = (path: string, cookie: string, init: RequestInit = {}) =>
  fetchWorker(
    new Request(`http://localhost/api${path}`, {
      ...init,
      headers: { cookie, "content-type": "application/json", ...init.headers },
    }),
  );

const createLink = (cookie: string, destination: string) =>
  api("/orgs/org-1/links", cookie, { method: "POST", body: JSON.stringify({ destination }) });

const admin = (path: string, cookie: string, init: RequestInit = {}) =>
  api(`/admin${path}`, cookie, init);

const row = (sql: string, ...binds: (string | number)[]) =>
  env.DB.prepare(sql)
    .bind(...binds)
    .first<Record<string, number | string | null>>();

async function syncKv(slug: string) {
  await applyStorageMessage(testEnv, drizzle(env.DB, { schema }), syncLinkMsg(slug, null));
}

const realFetch = globalThis.fetch;

beforeEach(async () => {
  reset();
  await applyTestMigrations();
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    // An answer the scorer reads as "no verdict", not a throw: the scoring
    // runs after the response, and a rejection landing once the test has
    // ended is an unhandled error.
    if (url.startsWith("https://security.cloudflare-dns.com"))
      return new Response("", { status: 503 });
    return realFetch(input, init);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("a scam-shaped destination", () => {
  it("is created on hold: the link exists, does not redirect, and the org is flagged", async () => {
    const owner = await freeOwnerCookie();
    const mail = captureEmails();

    const res = await createLink(owner, SCAM);
    const link = await jsonBody<{ id: string; slug: string }>(res);

    expect(res.status).toBe(201);
    await syncKv(link.slug);
    // Held (#344): the key answers "under review" and has no destination in it.
    expect(await env.LINKS.get(`slug:${link.slug}`)).toBe(
      JSON.stringify({ held: true, linkId: link.id, expiresAt: null }),
    );
    const held = await row("select suspended_at, suspend_reason from links where id = ?", link.id);
    expect(held?.suspended_at).not.toBeNull();
    expect(held?.suspend_reason).toContain("phonepe");
    expect((await row("select review_flagged_at as at from orgs"))?.at).not.toBeNull();
    expect(mail.sent.some((m) => m.to === "free@example.com" && /on hold/.test(m.subject))).toBe(
      true,
    );
    mail.restore();
  });

  it("is not held on a paid org, and an ordinary free-host app is left alone", async () => {
    const owner = await freeOwnerCookie();
    const ok = await jsonBody<{ id: string }>(
      await createLink(owner, "https://my-portfolio.vercel.app/"),
    );
    expect((await row("select suspended_at as at from links where id = ?", ok.id))?.at).toBeNull();

    await env.DB.prepare("update user set plan = 'pro' where id = 'free-1'").run();
    const paid = await jsonBody<{ id: string }>(await createLink(owner, SCAM));
    expect(
      (await row("select suspended_at as at from links where id = ?", paid.id))?.at,
    ).toBeNull();
  });

  it("is held when a clean link is edited to point at it", async () => {
    const owner = await freeOwnerCookie();
    const link = await jsonBody<{ id: string }>(await createLink(owner, "https://example.com/a"));

    await api(`/orgs/org-1/links/${link.id}`, owner, {
      method: "PATCH",
      body: JSON.stringify({ destination: SCAM }),
    });

    expect(
      (await row("select suspended_at as at from links where id = ?", link.id))?.at,
    ).not.toBeNull();
  });
});

describe("the blocklist", () => {
  it("refuses a blocked host for anyone, in any form of the address", async () => {
    const owner = await freeOwnerCookie();
    const cookie = await adminCookie();
    const added = await admin("/links/blocked-hosts", cookie, {
      method: "POST",
      body: JSON.stringify({ host: "https://WWW.Scam.Example/x", reason: "phishing kit" }),
    });
    expect(added.status).toBe(201);
    expect(await jsonBody<{ host: string }>(added)).toEqual({ host: "scam.example" });

    const res = await createLink(owner, "https://scam.example/other/path");
    expect(res.status).toBe(422);
    expect((await createLink(owner, "https://fine.example/")).status).toBe(201);
  });

  it("can be listed and a mistaken entry removed", async () => {
    const owner = await freeOwnerCookie();
    const cookie = await adminCookie();
    await admin("/links/blocked-hosts", cookie, {
      method: "POST",
      body: JSON.stringify({ host: "oops.example", reason: "mistake" }),
    });
    const list = await jsonBody<{ host: string }[]>(await admin("/links/blocked-hosts", cookie));
    expect(list.map((h) => h.host)).toEqual(["oops.example"]);

    expect(
      (await admin("/links/blocked-hosts/oops.example", cookie, { method: "DELETE" })).status,
    ).toBe(200);
    expect((await createLink(owner, "https://oops.example/")).status).toBe(201);
  });

  it("needs a reason and a real host, and 404s for a non-admin", async () => {
    const owner = await freeOwnerCookie();
    const cookie = await adminCookie();
    const noReason = await admin("/links/blocked-hosts", cookie, {
      method: "POST",
      body: JSON.stringify({ host: "x.example" }),
    });
    expect(noReason.status).toBe(400);
    const junk = await admin("/links/blocked-hosts", cookie, {
      method: "POST",
      body: JSON.stringify({ host: "nodots", reason: "r" }),
    });
    expect(junk.status).toBe(400);
    expect((await admin("/links/blocked-hosts", owner)).status).toBe(404);
  });
});

const launchEnv = () =>
  overrideEnv({
    ...authEnv(),
    SHARED_LINK_HOST: "rdyr.cc",
    APP_HOST: "rdyrct.com",
    SUPERADMIN_EMAIL: "admin@example.com",
  });

const shorten = (destination: string) =>
  fetchWorker(
    new Request("http://localhost/api/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination }),
    }),
    launchEnv(),
  );

async function seedAnon(destination: string, token: string) {
  await env.DB.prepare(
    `insert into anon_links (id, slug, destination, claim_token, created_at, expires_at)
     values (?, ?, ?, ?, ?, ?)`,
  )
    .bind(`anon-${token}`, `s${token}`, destination, token, Date.now(), Date.now() + 3_600_000)
    .run();
}

describe("the anonymous shortener", () => {
  it("refuses a scam-shaped destination, and a blocked host, with a message", async () => {
    const refused = await shorten(SCAM);
    expect(refused.status).toBe(422);
    expect((await jsonBody<{ message: string }>(refused)).message).toMatch(/Sign up/);

    await env.DB.prepare(
      "insert into blocked_hosts (host, reason, created_at) values ('bad.example', 'x', 0)",
    ).run();
    expect((await shorten("https://bad.example/x")).status).toBe(422);
    expect((await shorten("https://fine.example/x")).status).toBe(201);
  });

  it("claiming a scam-shaped anonymous link creates it held, not live", async () => {
    await freeOwnerCookie();
    await seedAnon(SCAM, "tok1");
    const mail = captureEmails();

    const link = await claimAnonLink(testEnv, "org-1", "free-1", "tok1");

    expect(link?.suspendedAt).not.toBeNull();
    expect(link?.suspendReason).toContain("phonepe");
    mail.restore();
  });

  it("claiming refuses a link whose host was blocked after it was made", async () => {
    await freeOwnerCookie();
    await seedAnon("https://later-blocked.example/x", "tok2");
    await env.DB.prepare(
      "insert into blocked_hosts (host, reason, created_at) values ('later-blocked.example', 'x', 0)",
    ).run();

    expect(await claimAnonLink(testEnv, "org-1", "free-1", "tok2")).toBeNull();
    expect((await row("select count(*) as n from links"))?.n).toBe(0);
  });
});

describe("chaining through our own short links", () => {
  it("refuses a destination on the short host or a slug on the app host, but not our pages", async () => {
    const owner = await freeOwnerCookie();
    const create = (destination: string) =>
      fetchWorker(
        new Request("http://localhost/api/orgs/org-1/links", {
          method: "POST",
          headers: { cookie: owner, "content-type": "application/json" },
          body: JSON.stringify({ destination }),
        }),
        launchEnv(),
      );

    expect((await create("https://rdyr.cc/abc1234")).status).toBe(422);
    expect((await create("https://rdyrct.com/abc1234")).status).toBe(422);
    expect((await create("https://rdyrct.com/pricing")).status).toBe(201);
    expect((await create("https://rdyrct.com/")).status).toBe(201);
  });
});

describe("telling the founder", () => {
  it("emails the admin on the first report, and not again on the second", async () => {
    const owner = await freeOwnerCookie();
    await jsonBody<{ id: string; slug: string }>(await createLink(owner, "https://example.com/a"));
    const slug = String((await row("select slug from links"))?.slug);
    const mail = captureEmails();
    const report = () =>
      fetchWorker(
        new Request("http://localhost/api/reports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ link: slug, reason: "phishing" }),
        }),
        launchEnv(),
      );

    await report();
    await report();

    const toAdmin = mail.sent.filter((m) => m.to === "admin@example.com");
    expect(toAdmin).toHaveLength(1);
    expect(toAdmin[0]?.subject).toBe("A link was reported");
    mail.restore();
  });

  it("emails the admin when a link is held at creation, and says only 'imitate' to the owner", async () => {
    const owner = await freeOwnerCookie();
    const mail = captureEmails();

    await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie: owner, "content-type": "application/json" },
        body: JSON.stringify({ destination: SCAM }),
      }),
      launchEnv(),
    );

    expect(mail.sent.some((m) => m.to === "admin@example.com" && /held/i.test(m.subject))).toBe(
      true,
    );
    const ownerMail = mail.sent.find((m) => m.to === "free@example.com");
    expect(ownerMail?.text).toContain("imitate another site");
    expect(ownerMail?.text).not.toMatch(/phonepe|railway/i);
    mail.restore();
  });
});
