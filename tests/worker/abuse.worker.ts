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
});

describe("sweepAbusiveOrgs", () => {
  it("suspends a free org past the redirect ceiling and alerts", async () => {
    await seedLink();
    await seedFreeOwner();
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

  it("leaves an org under the ceiling alone", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY - 1);

    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(0);
  });

  it("does not touch a paid org over the ceiling", async () => {
    await seedLink();
    await seedFreeOwner();
    await env.DB.prepare("update user set plan = 'pro' where id = 'owner-1'").run();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY + 1);

    await sweepAbusiveOrgs(testEnv);

    expect(await suspendedCount()).toBe(0);
  });

  it("is idempotent: a second pass suspends nothing more", async () => {
    await seedLink();
    await seedFreeOwner();
    await seedClicksToday(REDIRECT_CEILING_PER_DAY + 1);
    const alert = vi.spyOn(Sentry, "captureMessage").mockReturnValue("");

    await sweepAbusiveOrgs(testEnv);
    alert.mockClear();
    await sweepAbusiveOrgs(testEnv);

    expect(alert).not.toHaveBeenCalledWith("org_auto_suspended", expect.anything());
    alert.mockRestore();
  });
});
