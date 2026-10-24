// fallow-ignore-file code-duplication -- specs repeat their setup so each reads on its own
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { rescanFreeLinks, WEB_RISK_RESCAN_BATCH } from "../../src/worker/destination-check";
import type { Env } from "../../src/worker/env";
import {
  applyTestMigrations,
  authEnv,
  captureEmails,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
} from "./support";

/**
 * Google Web Risk as the second destination check (#341), with Google's API
 * stubbed: what a hit holds, and how far, on create, on edit, and in the
 * weekly rescan. How its answers are read is tests/risk.test.ts.
 */

const KEY = "test-web-risk-key";
const LISTED = "https://kit.example/login";
const realFetch = globalThis.fetch;

/** Google lists any URL on kit.example; the DNS resolver passes everything. */
function stubGoogle(options: { down?: boolean } = {}) {
  const lookups: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://webrisk.googleapis.com/")) {
      const uri = new URL(url).searchParams.get("uri") ?? "";
      lookups.push(uri);
      if (options.down) throw new Error("timeout");
      const listed = new URL(uri).hostname === "kit.example";
      return new Response(
        JSON.stringify(listed ? { threat: { threatTypes: ["SOCIAL_ENGINEERING"] } } : {}),
      );
    }
    if (url.startsWith("https://security.cloudflare-dns.com"))
      return new Response(JSON.stringify({ Status: 0, Answer: [{ data: "93.184.216.34" }] }));
    return realFetch(input, init);
  };
  return lookups;
}

const withKey = (): Env => ({ ...authEnv(), WEB_RISK_API_KEY: KEY });

async function createLink(cookie: string, destination: string, testEnv = withKey()) {
  const res = await fetchWorker(
    new Request("http://localhost/api/orgs/org-1/links", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ destination }),
    }),
    testEnv,
  );
  expect(res.status).toBe(201);
  return (await jsonBody<{ id: string }>(res)).id;
}

const linkRow = (id: string) =>
  env.DB.prepare(
    "select suspended_at, suspend_reason, risk_score, risk_reasons, web_risk_checked_at from links where id = ?",
  )
    .bind(id)
    .first<{
      suspended_at: number | null;
      suspend_reason: string | null;
      risk_score: number | null;
      risk_reasons: string | null;
      web_risk_checked_at: number | null;
    }>();

const orgRow = () =>
  env.DB.prepare(
    "select review_flagged_at as flagged, links_suspended_at as suspended from orgs where id = 'org-1'",
  ).first<{ flagged: number | null; suspended: number | null }>();

/** Make every write to `links.suspended_at` throw, the way a hold fails
 * partway: after the Web Risk stamp, before the link is held. */
const failHolds = () =>
  env.DB.prepare(
    "create trigger fail_hold before update of suspended_at on links begin select raise(abort, 'hold failed'); end",
  ).run();
const allowHolds = () => env.DB.prepare("drop trigger fail_hold").run();

const makeOrgNew = () =>
  env.DB.prepare("update orgs set created_at = ? where id = 'org-1'").bind(Date.now()).run();

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("a hit on create", () => {
  it("on an established free org, holds that link only and flags the org", async () => {
    stubGoogle();
    const cookie = await freeOwnerCookie();
    const clean = await createLink(cookie, "https://example.com/fine");
    const mail = captureEmails();
    const listed = await createLink(cookie, LISTED);

    const row = await linkRow(listed);
    expect(row?.suspended_at).not.toBeNull();
    expect(row?.suspend_reason).toContain("Google Web Risk");
    expect(row?.risk_score).toBe(100);
    expect(JSON.parse(row?.risk_reasons ?? "[]")).toContain("web_risk_social_engineering");
    expect(row?.web_risk_checked_at).toBeGreaterThan(0);
    expect((await linkRow(clean))?.suspended_at).toBeNull();
    expect(await orgRow()).toMatchObject({ suspended: null });
    expect((await orgRow())?.flagged).not.toBeNull();
    const owner = mail.sent.filter((m) => m.to === "free@example.com");
    expect(owner.map((m) => m.subject)).toEqual(["A link is on hold"]);
    mail.restore();
  });

  it("on a free org under seven days old, holds every link it has", async () => {
    stubGoogle();
    const cookie = await freeOwnerCookie();
    await makeOrgNew();
    const clean = await createLink(cookie, "https://example.com/fine");
    const listed = await createLink(cookie, LISTED);

    expect((await linkRow(listed))?.suspended_at).not.toBeNull();
    expect((await linkRow(clean))?.suspended_at).not.toBeNull();
    expect((await orgRow())?.suspended).not.toBeNull();
  });

  it("on a new paid org, holds that link only: the owner went through billing", async () => {
    stubGoogle();
    const cookie = await freeOwnerCookie();
    await makeOrgNew();
    await env.DB.prepare("update user set plan = 'pro' where id = 'free-1'").run();
    const clean = await createLink(cookie, "https://example.com/fine");
    const listed = await createLink(cookie, LISTED);

    expect((await linkRow(listed))?.suspended_at).not.toBeNull();
    expect((await linkRow(clean))?.suspended_at).toBeNull();
    expect((await orgRow())?.suspended).toBeNull();
  });

  it("still creates the link when Google is down, and leaves it for the rescan", async () => {
    stubGoogle({ down: true });
    const cookie = await freeOwnerCookie();
    const id = await createLink(cookie, LISTED);

    const row = await linkRow(id);
    expect(row?.suspended_at).toBeNull();
    expect(row?.web_risk_checked_at).toBeNull();
    // The DNS check still answered.
    expect(row?.risk_score).toBe(0);
  });

  it("leaves a hit it failed to hold unstamped, so the next rescan holds it", async () => {
    stubGoogle();
    const cookie = await freeOwnerCookie();
    await failHolds();
    const id = await createLink(cookie, LISTED);

    const row = await linkRow(id);
    expect(row?.suspended_at).toBeNull();
    expect(row?.web_risk_checked_at).toBeNull();

    await allowHolds();
    await rescanFreeLinks(withKey());
    expect((await linkRow(id))?.suspended_at).not.toBeNull();
  });

  it("never calls Google without a key", async () => {
    const lookups = stubGoogle();
    const cookie = await freeOwnerCookie();
    const id = await createLink(cookie, LISTED, authEnv());
    expect(lookups).toHaveLength(0);
    expect((await linkRow(id))?.suspended_at).toBeNull();
  });
});

describe("a hit on edit", () => {
  it("holds a link swapped to a listed destination after it was made clean", async () => {
    stubGoogle();
    const cookie = await freeOwnerCookie();
    const id = await createLink(cookie, "https://example.com/fine");
    expect((await linkRow(id))?.suspended_at).toBeNull();

    const res = await fetchWorker(
      new Request(`http://localhost/api/orgs/org-1/links/${id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination: LISTED }),
      }),
      withKey(),
    );
    expect(res.status).toBe(200);
    expect((await linkRow(id))?.suspended_at).not.toBeNull();
  });
});

describe("the weekly rescan", () => {
  /** `n` live links in org-1, never looked at by Web Risk. */
  async function seedLinks(n: number, destination = "https://example.com/x") {
    await env.DB.prepare(
      `insert into links (id, org_id, slug, destination, created_at)
       select 'bulk-' || x, 'org-1', 'bulk' || x, ?, 0
       from (with recursive c(x) as (select 1 union all select x + 1 from c where x < ?) select x from c)`,
    )
      .bind(destination, n)
      .run();
  }

  it("holds a free link that went bad after it was made, and stamps the clean ones", async () => {
    await freeOwnerCookie();
    await seedLinks(2);
    await env.DB.prepare("update links set destination = ? where id = 'bulk-1'").bind(LISTED).run();
    stubGoogle();

    expect(await rescanFreeLinks(withKey())).toBe(2);

    expect((await linkRow("bulk-1"))?.suspended_at).not.toBeNull();
    const clean = await linkRow("bulk-2");
    expect(clean?.suspended_at).toBeNull();
    expect(clean?.web_risk_checked_at).toBeGreaterThan(0);
    // A clean answer does not write a score over the DNS check's.
    expect(clean?.risk_score).toBeNull();
  });

  it("leaves a hit it failed to hold unstamped, so the next run tries again", async () => {
    await freeOwnerCookie();
    await seedLinks(1, LISTED);
    stubGoogle();
    await failHolds();

    await rescanFreeLinks(withKey());
    const row = await linkRow("bulk-1");
    expect(row?.suspended_at).toBeNull();
    expect(row?.web_risk_checked_at).toBeNull();

    await allowHolds();
    await rescanFreeLinks(withKey());
    expect((await linkRow("bulk-1"))?.suspended_at).not.toBeNull();
  });

  it("skips links checked this week, paid links, and held links", async () => {
    await freeOwnerCookie();
    await seedLinks(3);
    await env.DB.prepare("update links set web_risk_checked_at = ? where id = 'bulk-1'")
      .bind(Date.now() - 86_400_000)
      .run();
    await env.DB.prepare("update links set suspended_at = 1 where id = 'bulk-2'").run();
    const lookups = stubGoogle();

    await rescanFreeLinks(withKey());
    expect(lookups).toHaveLength(1);

    await env.DB.prepare("update user set plan = 'hobby' where id = 'free-1'").run();
    await env.DB.prepare("update links set web_risk_checked_at = null").run();
    await rescanFreeLinks(withKey());
    expect(lookups).toHaveLength(1);
  });

  it("looks at no more than one batch a day", async () => {
    await freeOwnerCookie();
    await seedLinks(WEB_RISK_RESCAN_BATCH + 5);
    const lookups = stubGoogle();

    await rescanFreeLinks(withKey());
    expect(lookups).toHaveLength(WEB_RISK_RESCAN_BATCH);
  });

  it("does nothing without a key, and stamps nothing when Google is down", async () => {
    await freeOwnerCookie();
    await seedLinks(1);
    const lookups = stubGoogle({ down: true });

    expect(await rescanFreeLinks(authEnv())).toBe(0);
    expect(lookups).toHaveLength(0);
    expect(await rescanFreeLinks(withKey())).toBe(0);
    expect((await linkRow("bulk-1"))?.web_risk_checked_at).toBeNull();
  });
});
