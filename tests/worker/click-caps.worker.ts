import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset, runDurableObjectAlarm } from "cloudflare:test";
import { insertClicks, type ClickMessage } from "../../src/worker/clicks";
import { clickUsageEmail, sweepClickUsageEmails } from "../../src/worker/click-caps";
import { redirectsByOrg, sweepOldOverflow } from "../../src/worker/click-overflow";
import { sweepAbusiveOrgs } from "../../src/worker/abuse";
import * as schema from "../../src/worker/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { monthKey, monthName } from "../../src/shared/click-usage";
import { PLAN_LIMITS, type ClickUsage, type StoredPlan } from "../../src/shared/types";
import {
  applyTestMigrations,
  bufferedClicks,
  captureEmails,
  clicksStub,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  overrideEnv,
  resetClicks,
  sampleAddress,
  sampleLink,
  seedLink,
  testEnv,
} from "./support";

/**
 * Tracked clicks per plan (#387): past an org's monthly cap its links keep
 * redirecting and the clicks are not recorded; the counter is exact; the
 * owner hears about it once at 80% and once at 100%.
 */

const NOW = Date.now();
const MONTH = monthKey(NOW);

beforeEach(async () => {
  await applyTestMigrations();
  await resetClicks();
});
afterEach(reset);

/** org-1 and link-1, owned by a user on `plan`. */
async function seedOwnedLink(plan: StoredPlan = "free") {
  await seedLink();
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('owner-1', 'Owner', 'owner@example.com', 1, 0, ?, 0, 0)",
    ).bind(plan),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'owner-1', 'owner', 0)",
    ),
  ]);
}

function clicks(n: number, prefix: string, ts = NOW): ClickMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    dedupeId: `${prefix}-${i}`,
    linkId: sampleLink.id,
    addressId: sampleAddress.id,
    orgId: sampleLink.orgId,
    ts,
    country: "US",
    referrer: "",
    device: "desktop",
  }));
}

async function setUsage(count: number, month = MONTH) {
  await env.DB.prepare(
    `insert into org_click_usage (org_id, month, clicks) values ('org-1', ?, ?)
     on conflict (org_id, month) do update set clicks = excluded.clicks`,
  )
    .bind(month, count)
    .run();
}

async function usage(month = MONTH): Promise<number | undefined> {
  const row = await env.DB.prepare(
    "select clicks from org_click_usage where org_id = 'org-1' and month = ?",
  )
    .bind(month)
    .first<{ clicks: number }>();
  return row?.clicks;
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`select count(*) as n from ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

/** What one click is in every table that records it. */
async function recorded() {
  const daily = await env.DB.prepare(
    "select coalesce(sum(clicks), 0) as n from click_daily",
  ).first<{ n: number }>();
  return {
    raw: await count("clicks"),
    daily: daily?.n ?? 0,
    dims: await count("click_daily_dims"),
    hourly: await count("click_hourly"),
  };
}

describe("the monthly cap at flush time", () => {
  it("records every click while the org is under its cap, and counts them", async () => {
    await seedOwnedLink("free");
    expect(await insertClicks(testEnv, clicks(10, "a"))).toEqual({
      retry: [],
      hadFailure: false,
    });
    expect((await recorded()).raw).toBe(10);
    expect(await usage()).toBe(10);
  });

  it("writes no raw row and no rollup for a click past the cap", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks);

    expect(await insertClicks(testEnv, clicks(3, "over"))).toEqual({
      retry: [],
      hadFailure: false,
    });

    expect(await recorded()).toEqual({ raw: 0, daily: 0, dims: 0, hourly: 0 });
    expect(await usage()).toBe(PLAN_LIMITS.free.trackedClicks);
  });

  it("spends one unit on a click that appears twice in a flush", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks - 2);
    // dup-0, then dup-0 and dup-1.
    await insertClicks(testEnv, [...clicks(1, "dup"), ...clicks(2, "dup")]);

    // Stored once, so it spends one unit and the other click still fits.
    expect((await recorded()).raw).toBe(2);
    expect(await usage()).toBe(PLAN_LIMITS.free.trackedClicks);
  });

  it("records only what is left of the allowance, the earliest clicks first", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks - 2);

    await insertClicks(testEnv, clicks(5, "edge"));

    const ids = await env.DB.prepare("select dedupe_id from clicks order by dedupe_id").all<{
      dedupe_id: string;
    }>();
    expect(ids.results.map((r) => r.dedupe_id)).toEqual(["edge-0", "edge-1"]);
    expect((await recorded()).daily).toBe(2);
    expect(await usage()).toBe(PLAN_LIMITS.free.trackedClicks);
  });

  it.each([
    ["hobby", PLAN_LIMITS.hobby.trackedClicks],
    ["pro", PLAN_LIMITS.pro.trackedClicks],
  ] as const)("holds a %s org to %i", async (plan, limit) => {
    await seedOwnedLink(plan);
    // Past the free cap, so a plan lookup that fell back to free would
    // record nothing.
    await setUsage(limit - 1);

    await insertClicks(testEnv, clicks(3, plan));

    expect((await recorded()).raw).toBe(1);
    expect(await usage()).toBe(limit);
  });

  it("caps nobody on an instance that sells no plans", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks);
    const selfHosted = overrideEnv({ POLAR_ACCESS_TOKEN: undefined, BILLING: undefined });

    await insertClicks(selfHosted, clicks(3, "self"));

    expect((await recorded()).raw).toBe(3);
  });

  it("counts each click against the month it happened in", async () => {
    await seedOwnedLink("free");
    const lastMonth = Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth(), 0);
    await setUsage(PLAN_LIMITS.free.trackedClicks, monthKey(lastMonth));

    // One flush that straddles midnight on the 1st.
    await insertClicks(testEnv, [...clicks(2, "late", lastMonth), ...clicks(2, "early")]);

    expect((await recorded()).raw).toBe(2);
    expect(await usage(monthKey(lastMonth))).toBe(PLAN_LIMITS.free.trackedClicks);
    expect(await usage()).toBe(2);
  });

  it("keeps the counter exact across chunks, redelivery and the per-row fallback", async () => {
    await seedOwnedLink("pro");
    const rows = clicks(450, "big"); // three chunks of the batch

    await insertClicks(testEnv, rows);
    // A flush that wrote but heard back an error, delivered again.
    await insertClicks(testEnv, rows);
    // The same id twice in one flush.
    const twice = clicks(1, "twice")[0]!;
    await insertClicks(testEnv, [twice, twice]);
    // A deleted link sends the batch row by row: the counter rides each row.
    await insertClicks(testEnv, [
      ...rows.slice(0, 3),
      ...clicks(2, "fallback"),
      { ...twice, dedupeId: "gone", linkId: "no-such-link" },
    ]);
    // And through the buffer's own alarm.
    const stub = clicksStub();
    await stub.add(rows[0]!);
    await stub.add(clicks(1, "alarm")[0]!);
    await runDurableObjectAlarm(stub);

    const raw = await count("clicks");
    expect(raw).toBe(450 + 1 + 2 + 1);
    expect(await usage()).toBe(raw);
  });

  it("drops a capped click that arrives through a real redirect, which still goes out", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks);
    await env.LINKS.put(
      `slug:${sampleAddress.slug}`,
      JSON.stringify({
        linkId: sampleLink.id,
        addressId: sampleAddress.id,
        orgId: sampleLink.orgId,
        url: "https://example.com/sale",
      }),
    );

    const response = await fetchWorker(
      new Request(`http://localhost/${sampleAddress.slug}`, { redirect: "manual" }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/sale");
    // The click reached the buffer, so the flush below is what drops it.
    expect(await bufferedClicks()).toHaveLength(1);
    await runDurableObjectAlarm(clicksStub());
    expect(await bufferedClicks()).toEqual([]);
    expect(await recorded()).toEqual({ raw: 0, daily: 0, dims: 0, hourly: 0 });
    expect(await usage()).toBe(PLAN_LIMITS.free.trackedClicks);
  });
});

describe("GET /orgs/:orgId/click-usage", () => {
  it("returns this month's count against the plan's cap", async () => {
    const cookie = await freeOwnerCookie();
    await env.DB.prepare(
      "insert into org_click_usage (org_id, month, clicks) values ('org-1', ?, 4321)",
    )
      .bind(MONTH)
      .run();

    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/click-usage", { headers: { cookie } }),
    );

    expect(res.status).toBe(200);
    const body = await jsonBody<ClickUsage>(res);
    expect(body).toMatchObject({
      month: MONTH,
      clicks: 4321,
      limit: PLAN_LIMITS.free.trackedClicks,
    });
    expect(monthKey(body.resetsAt)).not.toBe(MONTH);
    expect(monthKey(body.resetsAt - 1)).toBe(MONTH);
  });
});

describe("the 80% and 100% emails", () => {
  async function sweep() {
    const mail = captureEmails();
    try {
      await sweepClickUsageEmails(testEnv, NOW);
      return mail.sent;
    } finally {
      mail.restore();
    }
  }

  it("sends the 80% email once, then the 100% email once", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks * 0.8 - 1);
    expect(await sweep()).toEqual([]);

    await setUsage(PLAN_LIMITS.free.trackedClicks * 0.8);
    const near = await sweep();
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ to: "owner@example.com" });
    expect(near[0]!.subject).toContain("80%");
    expect(await sweep()).toEqual([]);

    await setUsage(PLAN_LIMITS.free.trackedClicks);
    const reached = await sweep();
    expect(reached).toHaveLength(1);
    expect(reached[0]!.subject).toContain("5,000 tracked clicks");
    expect(reached[0]!.text).toContain("Your links still work.");
    expect(await sweep()).toEqual([]);
  });

  it("sends one email when two runs overlap (the 10-minute and the daily trigger)", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks);
    const mail = captureEmails();
    try {
      await Promise.all([sweepClickUsageEmails(testEnv, NOW), sweepClickUsageEmails(testEnv, NOW)]);
      expect(mail.sent).toHaveLength(1);
    } finally {
      mail.restore();
    }
  });

  it("sends only the 100% email to an org that jumped past 80% between runs", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks);

    const sent = await sweep();
    expect(sent.map((m) => m.subject)).toEqual([expect.stringContaining("5,000 tracked clicks")]);
    expect(await sweep()).toEqual([]);
  });

  it("holds each plan to its own cap", async () => {
    await seedOwnedLink("hobby");
    await setUsage(PLAN_LIMITS.free.trackedClicks);
    expect(await sweep()).toEqual([]);

    await setUsage(PLAN_LIMITS.hobby.trackedClicks * 0.8);
    expect(await sweep()).toHaveLength(1);
  });

  it("emails again when a plan change moves the cap", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks);
    expect(await sweep()).toHaveLength(1);

    await env.DB.prepare("update user set plan = 'hobby' where id = 'owner-1'").run();
    await setUsage(PLAN_LIMITS.hobby.trackedClicks);
    expect(await sweep()).toHaveLength(1);
  });

  it("tries again next run when the send fails", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks);
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response("down", { status: 503 });
    try {
      expect(await sweepClickUsageEmails(testEnv, NOW)).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
    expect(await sweep()).toHaveLength(1);
  });

  it("sends nothing on an instance that sells no plans", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks);
    const mail = captureEmails();
    try {
      await sweepClickUsageEmails(
        overrideEnv({ POLAR_ACCESS_TOKEN: undefined, BILLING: undefined }),
        NOW,
      );
      expect(mail.sent).toEqual([]);
    } finally {
      mail.restore();
    }
  });

  it("says the links keep working, and offers more only where a plan has more", () => {
    const base = { name: "Acme", clicks: 500_000, limit: 500_000, now: NOW };
    const pro = clickUsageEmail("reached", { ...base, plan: "pro" }, "https://x.test", "a@b.c");
    expect(pro.body.text).toContain("Your links still work.");
    expect(pro.body.text).not.toContain("Upgrade");
    // Where to write for more is the footer's "Questions? Write to ...":
    // said once, not twice.
    expect(pro.body.text.split("support@mail.rdyrct.com")).toHaveLength(2);
    expect(pro.body.text).toContain("Questions? Write to support@mail.rdyrct.com.");
    const proNear = clickUsageEmail(
      "near",
      { ...base, plan: "pro", clicks: 400_000 },
      "https://x.test",
      "a@b.c",
    );
    expect(proNear.body.text).not.toContain("For more, write to");

    const free = clickUsageEmail(
      "near",
      { ...base, plan: "free", clicks: 4000, limit: 5000 },
      "https://x.test",
      "a@b.c",
    );
    expect(free.subject).toContain("80%");
    expect(free.body.text).toContain("4,000 of the 5,000");
    expect(free.body.text).toContain("Hobby counts 50,000");
  });

  it("names the cap, not a count it never stored, after a downgrade", () => {
    // A Pro org with 100,000 clicks that moved to Free.
    const mail = clickUsageEmail(
      "reached",
      { name: "Acme", plan: "free", clicks: 100_000, limit: 5_000, now: NOW },
      "https://x.test",
      "a@b.c",
    );
    expect(mail.subject).toBe(
      `Acme has reached its plan's 5,000 tracked clicks for ${monthName(NOW)}`,
    );
    // The heading is the subject; nothing in the mail claims a count of 5,000.
    expect(mail.body.text).toContain(mail.subject);
    expect(mail.body.text).not.toMatch(/used its|recorded 5,000/);
  });
});

describe("the abuse sweep past the cap", () => {
  /** org-1 made just now, its free owner already at the cap. */
  async function seedCappedNewOrg() {
    await seedOwnedLink("free");
    await env.DB.prepare("update orgs set created_at = ? where id = 'org-1'").bind(NOW).run();
    await setUsage(PLAN_LIMITS.free.trackedClicks);
  }

  const reviewFlag = async () =>
    (
      await env.DB.prepare("select review_flagged_at as at from orgs where id = 'org-1'").first<{
        at: number | null;
      }>()
    )?.at ?? null;

  it("counts dropped clicks per link per minute, one row however many clicks", async () => {
    await seedCappedNewOrg();
    await insertClicks(testEnv, clicks(250, "drop"));

    expect((await recorded()).raw).toBe(0);
    const rows = await env.DB.prepare("select minute, clicks from click_overflow").all<{
      minute: number;
      clicks: number;
    }>();
    expect(rows.results).toEqual([{ minute: NOW - (NOW % 60_000), clicks: 250 }]);
  });

  it("still sees a burst the org sends after its cap, though none of it is stored", async () => {
    await seedCappedNewOrg();
    // Past the 200-an-hour burst check, all of it dropped by the cap.
    await insertClicks(testEnv, clicks(250, "burst"));
    expect((await recorded()).raw).toBe(0);

    await sweepAbusiveOrgs(testEnv);

    expect(await reviewFlag()).not.toBeNull();
  });

  it("still sees a new link pushed past 300 after the cap, outside the last hour", async () => {
    await seedCappedNewOrg();
    await env.DB.prepare("update links set created_at = ? where id = 'link-1'").bind(NOW).run();
    // Two hours ago, so the burst check sees none of it: only the new-link
    // check can catch this, and only by counting what was dropped.
    const twoHoursAgo = NOW - 2 * 60 * 60 * 1000;
    await setUsage(PLAN_LIMITS.free.trackedClicks, monthKey(twoHoursAgo));
    await insertClicks(testEnv, clicks(320, "fresh", twoHoursAgo));
    expect((await recorded()).raw).toBe(0);

    await sweepAbusiveOrgs(testEnv);

    expect(await reviewFlag()).not.toBeNull();
  });

  it("still counts the dropped clicks when the batch fails over a deleted link", async () => {
    await seedCappedNewOrg();
    // Another org's click on a link deleted since: its foreign key fails the
    // whole batch, which rolls back the overflow count with it.
    const gone: ClickMessage = {
      ...clicks(1, "gone")[0],
      orgId: "org-2",
      linkId: "no-such-link",
    };
    expect(await insertClicks(testEnv, [...clicks(4, "drop"), gone])).toEqual({
      retry: [],
      hadFailure: false,
    });

    const left = await env.DB.prepare("select sum(clicks) as n from click_overflow").first<{
      n: number;
    }>();
    expect(left?.n).toBe(4);
  });

  it("adds what was stored and what was dropped into one count", async () => {
    await seedOwnedLink("free");
    await setUsage(PLAN_LIMITS.free.trackedClicks - 100);
    await insertClicks(testEnv, clicks(150, "mixed"));
    expect((await recorded()).raw).toBe(100);

    const rows = await redirectsByOrg(drizzle(env.DB, { schema }), NOW - 60_000, 1);

    expect(rows).toEqual([{ orgId: "org-1", n: 150 }]);
  });

  it("drops counts older than two days, and keeps the rest", async () => {
    await seedCappedNewOrg();
    const threeDaysAgo = NOW - 3 * 24 * 60 * 60 * 1000;
    await setUsage(PLAN_LIMITS.free.trackedClicks, monthKey(threeDaysAgo));
    await insertClicks(testEnv, clicks(5, "old", threeDaysAgo));
    await insertClicks(testEnv, clicks(5, "new"));

    await sweepOldOverflow(testEnv, NOW);

    const left = await env.DB.prepare("select sum(clicks) as n from click_overflow").first<{
      n: number;
    }>();
    expect(left?.n).toBe(5);
  });
});
