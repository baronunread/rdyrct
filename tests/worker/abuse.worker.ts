// fallow-ignore-file code-duplication -- sweep specs repeat their setup so each reads on its own
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import {
  assertNotShortener,
  isShortenerDestination,
  REDIRECT_CEILING_PER_DAY,
  suspendOrgLinks,
  sweepAbusiveOrgs,
} from "../../src/worker/abuse";
import {
  applyTestMigrations,
  captureEmails,
  fetchWorker,
  freeOwnerCookie,
  sampleLink,
  seedLink,
  testEnv,
} from "./support";

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});

const db = () => drizzle(env.DB, { schema });

/** Give seedLink()'s `org-1` a free owner, so orgPlan() resolves to "free".
 * seedLink already created the orgs row, so this adds only the user and the
 * membership. */
async function seedFreeOwner() {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('owner-1', 'Owner', 'owner@example.com', 1, 0, 'free', 0, 0)",
    ),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'owner-1', 'owner', 0)",
    ),
  ]);
}

/** seedLink() dates org-1 at epoch 0, which reads as an ancient, established
 * org under the new-org gate. The auto-suspend tests want a fresh one. */
async function seedNewOrg() {
  await env.DB.prepare("update orgs set created_at = ? where id = 'org-1'").bind(Date.now()).run();
}

/** An org past the 72-hour hold window but inside the seven-day new-org one:
 * it is flagged for review, not held. */
async function seedFourDayOldOrg() {
  await env.DB.prepare("update orgs set created_at = ? where id = 'org-1'")
    .bind(Date.now() - 4 * 86_400_000)
    .run();
}

/** `count` click rows for the sample link, all timestamped today. */
async function seedClicksToday(count: number) {
  await env.DB.prepare(
    `insert into clicks (link_id, org_id, ts, country, referrer, device)
     select ?, ?, ?, '', '', ''
     from (with recursive c(x) as (select 1 union all select x + 1 from c where x < ?) select x from c)`,
  )
    .bind(sampleLink.id, sampleLink.orgId, Date.now(), count)
    .run();
}

const reviewFlag = async () =>
  (
    await env.DB.prepare("select review_flagged_at as at from orgs where id = 'org-1'").first<{
      at: number | null;
    }>()
  )?.at ?? null;

const suspendedCount = async () =>
  (
    await env.DB.prepare(
      "select count(*) as n from links where org_id = ? and suspended_at is not null",
    )
      .bind(sampleLink.orgId)
      .first<{ n: number }>()
  )?.n ?? 0;

describe("assertNotShortener", () => {
  it("flags known shorteners, including the ones from the incident", () => {
    for (const url of [
      "https://bit.ly/abc",
      "https://bitly.cx/I8r0v",
      "https://smsg.us/P4TSsO",
      "https://tinyurl.com/x",
      "https://go.rebrand.ly/deep", // subdomain
    ])
      expect(isShortenerDestination(url)).toBe(true);
  });

  it("passes an ordinary destination and a string that is not a URL", () => {
    expect(isShortenerDestination("https://example.com/pricing")).toBe(false);
    expect(isShortenerDestination("not a url")).toBe(false);
  });

  it("throws a 422 from assertNotShortener", () => {
    expect(() => assertNotShortener("https://bit.ly/abc")).toThrow();
    expect(() => assertNotShortener("https://example.com")).not.toThrow();
  });

  it("the link create route rejects a shortener destination", async () => {
    const cookie = await freeOwnerCookie();

    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination: "https://bit.ly/whatever" }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe("suspendOrgLinks", () => {
  it("suspends live links, republishes them, and is a no-op the second time", async () => {
    await seedLink();

    const first = await suspendOrgLinks(testEnv, db(), sampleLink.orgId, null, "test");
    expect(first).toBe(1);
    expect(await suspendedCount()).toBe(1);

    // An admin action is recorded for the automatic suspension.
    const action = await env.DB.prepare(
      "select action, actor_user_id from admin_actions where target_id = ?",
    )
      .bind(sampleLink.orgId)
      .first<{ action: string; actor_user_id: string }>();
    expect(action).toEqual({ action: "org.suspend_links", actor_user_id: "system" });

    const second = await suspendOrgLinks(testEnv, db(), sampleLink.orgId, null, "test");
    expect(second).toBe(0);
  });

  it("blocks new link creation until the org is unsuspended (org-role.ts's assertOrgWritable)", async () => {
    const cookie = await freeOwnerCookie();
    await suspendOrgLinks(testEnv, db(), "org-1", null, "test");

    const blocked = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination: "https://example.com/new" }),
      }),
    );
    expect(blocked.status).toBe(403);

    await env.DB.prepare("update orgs set links_suspended_at = null where id = 'org-1'").run();

    const restored = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination: "https://example.com/new" }),
      }),
    );
    expect(restored.status).toBe(201);
  });
});

describe("sweepAbusiveOrgs", () => {
  it("suspends a free, brand-new org past the redirect ceiling and alerts", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY + 1);
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(1);
    expect(alert).toHaveBeenCalledWith(
      "org_auto_suspended",
      expect.objectContaining({ level: "error" }),
    );
    alert.mockRestore();
  });

  it("tells the owner to write to support, not to reply to a no-reply address", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY + 1);
    const mail = captureEmails();
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);

    const [owner] = mail.sent.filter((m) => m.to === "owner@example.com");
    expect(owner?.subject).toBe("Your organization is suspended");
    expect(owner?.text).toContain("write to support@mail.rdyrct.com");
    expect(owner?.text).not.toContain("reply to this email");
    // About their own account, so no "Not you? Ignore it".
    expect(owner?.text).toContain("Questions? Write to support@mail.rdyrct.com.");
    expect(owner?.text).not.toContain("Not you?");
    alert.mockRestore();
    mail.restore();
  });

  it("words the platform admin's copy as a report, not as their own suspension", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY + 1);
    const mail = captureEmails();
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs({ ...testEnv, SUPERADMIN_EMAIL: "admin@example.com" });

    const [copy] = mail.sent.filter((m) => m.to === "admin@example.com");
    expect(copy?.subject).toMatch(/^Auto-suspended:/);
    expect(copy?.subject).not.toContain("Your organization");
    expect(copy?.text).toContain("Your own organizations are not affected");
    expect(copy?.text).toContain("owner@example.com");
    alert.mockRestore();
    mail.restore();
  });

  it("holds a brand-new free org on a burst, tells the owner why, and acts once", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedClicksToday(201);
    const mail = captureEmails();
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);
    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(1);
    expect(alert.mock.calls.filter(([m]) => m === "org_held")).toHaveLength(1);
    const [owner] = mail.sent.filter((m) => m.to === "owner@example.com");
    expect(owner?.subject).toBe("Your links are on hold");
    expect(owner?.text).toContain("Held for review");
    expect(owner?.text).toContain("write to support@mail.rdyrct.com");
    expect(mail.sent.filter((m) => m.to === "owner@example.com")).toHaveLength(1);
    alert.mockRestore();
    mail.restore();
  });

  it("only flags an org between three and seven days old, and its links keep redirecting", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedFourDayOldOrg();
    await seedClicksToday(201);
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);
    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(0);
    expect(await reviewFlag()).not.toBeNull();
    expect(alert.mock.calls.filter(([m]) => m === "org_needs_review")).toHaveLength(1);
    alert.mockRestore();
  });

  it("flags a link made today that is already past 300 redirects, under the burst limit", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedFourDayOldOrg();
    await env.DB.prepare("update links set created_at = ?").bind(Date.now()).run();
    // Five hours ago, so the last-hour burst rule cannot be what fires.
    await env.DB.prepare(
      `insert into clicks (link_id, org_id, ts, country, referrer, device)
       select ?, ?, ?, '', '', ''
       from (with recursive c(x) as (select 1 union all select x + 1 from c where x < ?) select x from c)`,
    )
      .bind(sampleLink.id, sampleLink.orgId, Date.now() - 5 * 3_600_000, 350)
      .run();
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);

    expect(await reviewFlag()).not.toBeNull();
    alert.mockRestore();
  });

  it("does not hold an old link with the same traffic: only a new link is the signal", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedFourDayOldOrg();
    await env.DB.prepare(
      `insert into clicks (link_id, org_id, ts, country, referrer, device)
       select ?, ?, ?, '', '', ''
       from (with recursive c(x) as (select 1 union all select x + 1 from c where x < ?) select x from c)`,
    )
      .bind(sampleLink.id, sampleLink.orgId, Date.now() - 5 * 3_600_000, 350)
      .run();
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);

    expect(await reviewFlag()).toBeNull();
    alert.mockRestore();
  });

  it("leaves an established org's traffic alone", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY / 4 + 1);
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);

    expect(await reviewFlag()).toBeNull();
    alert.mockRestore();
  });

  it("does not suspend again an org an admin restored", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY + 1);
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");
    await sweepAbusiveOrgs(testEnv);
    expect(await suspendedCount()).toBe(1);

    // What the admin Restore does: links back, org cleared.
    await env.DB.prepare("update links set suspended_at = null").run();
    await env.DB.prepare("update orgs set cleared_at = ?, links_suspended_at = null")
      .bind(Date.now())
      .run();
    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(0);
    alert.mockRestore();
  });

  it("does not flag again an org an admin marked reviewed", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedFourDayOldOrg();
    await seedClicksToday(201);
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");
    await sweepAbusiveOrgs(testEnv);
    expect(await reviewFlag()).not.toBeNull();

    await env.DB.prepare("update orgs set review_flagged_at = null, cleared_at = ?")
      .bind(Date.now())
      .run();
    await sweepAbusiveOrgs(testEnv);

    expect(await reviewFlag()).toBeNull();
    alert.mockRestore();
  });

  it("counts a rolling 24 hours, not the UTC day", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    // Yesterday evening, always inside 24h and always before UTC midnight
    // when this runs shortly after it.
    await env.DB.prepare(
      `insert into clicks (link_id, org_id, ts, country, referrer, device)
       select ?, ?, ?, '', '', ''
       from (with recursive c(x) as (select 1 union all select x + 1 from c where x < ?) select x from c)`,
    )
      .bind(
        sampleLink.id,
        sampleLink.orgId,
        Date.now() - 20 * 60 * 60 * 1000,
        REDIRECT_CEILING_PER_DAY + 1,
      )
      .run();
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(1);
    alert.mockRestore();
  });

  it("leaves an org under every threshold alone", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedClicksToday(150);

    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(0);
  });

  it("does not touch a paid org over the ceiling", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await env.DB.prepare("update user set plan = 'pro' where id = 'owner-1'").run();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY + 1);

    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(0);
  });

  it("is idempotent: a second pass suspends nothing more", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedNewOrg();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY + 1);
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);
    alert.mockClear();
    await sweepAbusiveOrgs(testEnv);

    expect(alert).not.toHaveBeenCalledWith("org_auto_suspended", expect.anything());
    alert.mockRestore();
  });

  it("alerts but does not suspend an established org over the ceiling", async () => {
    // A flood aimed at any org's public link can clear the ceiling in
    // minutes (RL_CLICK_RECORDING allows 600/min), so raw volume alone
    // cannot be trusted to suspend an org that isn't new: that would make
    // our own abuse control a way to take down a stranger's links. seedLink
    // dates org-1 at epoch 0, well past the new-org window.
    await seedLink();
    await seedFreeOwner();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY + 1);
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(0);
    expect(alert).toHaveBeenCalledWith(
      "org_high_redirect_volume",
      expect.objectContaining({ level: "error" }),
    );
    expect(alert).not.toHaveBeenCalledWith("org_auto_suspended", expect.anything());
    alert.mockRestore();
  });
});
