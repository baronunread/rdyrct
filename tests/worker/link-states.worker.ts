// fallow-ignore-file code-duplication -- specs repeat their setup so each reads on its own
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import { applyStorageMessage, desiredLink, syncLinkMsg } from "../../src/worker/storage";
import { WARN_REASON, warnOrgLinks } from "../../src/worker/link-warning";
import {
  adminCookie,
  applyTestMigrations,
  freeOwnerCookie,
  bufferedClicks,
  fetchWorker,
  jsonBody,
  rawAddressRow,
  rawLinkRow,
  resetClicks,
  sampleLink,
  seedLink,
  testEnv,
} from "./support";

/**
 * Held and warned links (#344): both states ride in the KV value, so the
 * redirect path answers them with no D1 read, and neither page says why.
 */

const db = () => drizzle(env.DB, { schema });

/** Apply the sync a write enqueued, so KV holds what D1 now says. */
async function syncKv(slug = sampleLink.slug, hostname: string | null = null) {
  await applyStorageMessage(testEnv, db(), syncLinkMsg(slug, hostname));
}

const setLink = (sql: string) =>
  env.DB.prepare(`update links set ${sql} where id = ?`).bind(sampleLink.id).run();

/** A GET as a browser sends it: the Host header is what picks the host's
 * path in the Worker, and a bare Request does not set one. */
const get = (url: string) =>
  fetchWorker(
    new Request(url, { redirect: "manual", headers: { host: new URL(url).host } }),
    testEnv,
  );

beforeEach(async () => {
  reset();
  await applyTestMigrations();
  await resetClicks();
});

describe("the KV value", () => {
  it("is a held tombstone for a suspended link, with no destination in it", async () => {
    await seedLink("https://scam.example/login");
    await setLink(`suspended_at = ${Date.now()}`);

    expect(await desiredLink(db(), sampleLink.slug, null)).toEqual({
      held: true,
      linkId: sampleLink.id,
      expiresAt: null,
    });
    await syncKv();
    const raw = await env.LINKS.get(`slug:${sampleLink.slug}`);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("scam.example");
  });

  it("carries warn: true for a warned link, and nothing extra for an ordinary one", async () => {
    await seedLink("https://example.com/sale");
    expect(await desiredLink(db(), sampleLink.slug, null)).not.toHaveProperty("warn");

    await setLink(`warned_at = ${Date.now()}, warn_reason = 'Open report'`);
    expect(await desiredLink(db(), sampleLink.slug, null)).toMatchObject({
      url: "https://example.com/sale",
      warn: true,
    });
  });

  it("holds a custom domain's key too, under its own host", async () => {
    await seedLink();
    await env.DB.batch([
      env.DB.prepare(
        "insert into domains (id, org_id, hostname, status, created_at) values ('dom-1', 'org-1', 'go.example.com', 'active', 0)",
      ),
      env.DB.prepare("update link_addresses set domain_id = 'dom-1'"),
      env.DB.prepare("update links set domain_id = 'dom-1', suspended_at = ?").bind(Date.now()),
    ]);
    await syncKv(sampleLink.slug, "go.example.com");
    expect(await env.LINKS.get(`slug:go.example.com:${sampleLink.slug}`, "json")).toEqual({
      held: true,
      linkId: sampleLink.id,
      expiresAt: null,
    });
  });
});

describe("what a visitor sees", () => {
  it("a held link answers 'under review', not a 404, on every host, and records no click", async () => {
    await seedLink("https://scam.example/login");
    await setLink(`suspended_at = ${Date.now()}`);
    await syncKv();

    for (const host of ["localhost", env.SHARED_LINK_HOST]) {
      const res = await get(`http://${host}/${sampleLink.slug}`);
      expect(res.status, host).toBe(403);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html).toContain("This link is under review.");
      // It names neither the destination nor the rule that held it.
      expect(html).not.toContain("scam.example");
      expect(html).not.toMatch(/report|traffic|Google/i);
    }
    expect(await bufferedClicks()).toHaveLength(0);
  });

  it("a held link on a custom domain shows the page instead of the domain's root redirect", async () => {
    await env.LINKS.put(
      "domain:go.example.com",
      JSON.stringify({ domainId: "d", orgId: "org-1", rootRedirect: "https://example.com" }),
    );
    await env.LINKS.put(
      "slug:go.example.com:held",
      JSON.stringify({ held: true, linkId: "link-x", expiresAt: null }),
    );
    const res = await get("http://go.example.com/held");
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("This link is under review.");
  });

  it("an expired alias is a 404 whether or not its link is held", async () => {
    await env.LINKS.put(
      "slug:gone",
      JSON.stringify({ held: true, linkId: "link-x", expiresAt: Date.now() - 1000 }),
    );
    expect((await get("http://localhost/gone")).status).toBe(404);
  });

  it("a warned link shows the destination host and a Continue link, and counts the visit", async () => {
    await seedLink("https://shop.example.com/deal?id=1");
    await setLink(`warned_at = ${Date.now()}, warn_reason = 'Open report'`);
    await syncKv();

    const res = await get(`http://localhost/${sampleLink.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    const html = await res.text();
    expect(html).toContain("Check where this link goes.");
    expect(html).toMatch(/data-slot="warn-host"[^>]*>shop\.example\.com</);
    expect(html).toContain('href="https://shop.example.com/deal?id=1"');
    expect(html).not.toMatch(/report/i);
    expect(await bufferedClicks()).toHaveLength(1);
  });

  it("escapes the host and never offers a non-http URL as the button", async () => {
    await env.LINKS.put(
      "slug:odd",
      JSON.stringify({
        linkId: "link-x",
        addressId: "a",
        orgId: "",
        url: "javascript:alert(1)",
        expiresAt: null,
        warn: true,
      }),
    );
    const html = await (await get("http://localhost/odd")).text();
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="#"');
  });
});

describe("reports put a warning on the link", () => {
  const report = () =>
    fetchWorker(
      new Request("http://localhost/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ link: sampleLink.slug, reason: "phishing" }),
      }),
    );

  const warnRow = () =>
    env.DB.prepare("select warned_at, warn_reason from links where id = ?")
      .bind(sampleLink.id)
      .first<{ warned_at: number | null; warn_reason: string | null }>();

  it("warns on the first report, and the last dismissal lifts it", async () => {
    await seedLink();
    await report();
    expect((await warnRow())?.warn_reason).toBe("Open report");
    expect(await env.LINKS.get(`slug:${sampleLink.slug}`, "json")).toMatchObject({ warn: true });

    const cookie = await adminCookie();
    const { id } =
      (await env.DB.prepare("select id from link_reports").first<{ id: string }>()) ?? {};
    const dismissed = await fetchWorker(
      new Request(`http://localhost/api/admin/links/reports/${id}/dismiss`, {
        method: "POST",
        headers: { cookie },
      }),
    );
    expect(dismissed.status).toBe(200);
    expect((await warnRow())?.warned_at).toBeNull();
    expect(await env.LINKS.get(`slug:${sampleLink.slug}`, "json")).not.toHaveProperty("warn");
  });

  it("keeps the warning while another report is open, and keeps an admin's warning", async () => {
    await seedLink();
    await report();
    await report();
    const cookie = await adminCookie();
    const [first] = (await env.DB.prepare("select id from link_reports").all<{ id: string }>())
      .results;
    await fetchWorker(
      new Request(`http://localhost/api/admin/links/reports/${first?.id}/dismiss`, {
        method: "POST",
        headers: { cookie },
      }),
    );
    expect((await warnRow())?.warned_at).not.toBeNull();

    // An admin's own warning survives every report being dismissed.
    await setLink("warn_reason = 'Set by an admin'");
    await fetchWorker(
      new Request(`http://localhost/api/admin/links/orgs/org-1/reviewed`, {
        method: "POST",
        headers: { cookie },
      }),
    );
    expect((await warnRow())?.warn_reason).toBe("Set by an admin");
  });

  it("leaves an admin's warning when the last report is dismissed", async () => {
    await seedLink();
    await report();
    await setLink("warn_reason = 'Set by an admin'");
    const cookie = await adminCookie();
    const { id } =
      (await env.DB.prepare("select id from link_reports").first<{ id: string }>()) ?? {};
    await fetchWorker(
      new Request(`http://localhost/api/admin/links/reports/${id}/dismiss`, {
        method: "POST",
        headers: { cookie },
      }),
    );
    expect((await warnRow())?.warn_reason).toBe("Set by an admin");
  });

  it("does not warn a held link: it already serves nothing", async () => {
    await seedLink();
    await setLink(`suspended_at = ${Date.now()}`);
    await report();
    expect((await warnRow())?.warned_at).toBeNull();
  });
});

describe("PATCH /api/admin/links/:id/warning", () => {
  const setWarning = (cookie: string, warned: boolean, id = sampleLink.id) =>
    fetchWorker(
      new Request(`http://localhost/api/admin/links/${id}/warning`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ warned }),
      }),
    );

  it("sets and clears the warning in one call each, and republishes", async () => {
    await seedLink();
    const cookie = await adminCookie();

    expect((await setWarning(cookie, true)).status).toBe(200);
    expect(await env.LINKS.get(`slug:${sampleLink.slug}`, "json")).toMatchObject({ warn: true });
    const audit = await env.DB.prepare("select action from admin_actions where target_id = ?")
      .bind(sampleLink.id)
      .first<{ action: string }>();
    expect(audit?.action).toBe("link.warn");

    expect((await setWarning(cookie, false)).status).toBe(200);
    expect(await env.LINKS.get(`slug:${sampleLink.slug}`, "json")).not.toHaveProperty("warn");
  });

  it("refuses to warn a suspended link, and 404s for a link that is not there", async () => {
    await seedLink();
    await setLink(`suspended_at = ${Date.now()}`);
    const cookie = await adminCookie();
    expect((await setWarning(cookie, true)).status).toBe(409);
    expect((await setWarning(cookie, true, "nope")).status).toBe(404);
  });

  it("lists the warning on the admin links table", async () => {
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Test', 0)"),
    ]);
    await db()
      .insert(schema.links)
      .values(
        rawLinkRow({
          id: "link-w",
          orgId: "org-1",
          slug: "warned",
          destination: "https://example.com",
          createdAt: 0,
          warnedAt: 5,
          warnReason: "Open report",
        }),
      );
    await db()
      .insert(schema.linkAddresses)
      .values(
        rawAddressRow({
          id: "a-w",
          linkId: "link-w",
          orgId: "org-1",
          slug: "warned",
          kind: "primary",
          createdAt: 0,
        }),
      );
    const cookie = await adminCookie();
    const res = await fetchWorker(
      new Request("http://localhost/api/admin/links?warned=1", { headers: { cookie } }),
    );
    const rows = await jsonBody<{ slug: string; warnedAt: number | null }[]>(res);
    expect(rows.map((r) => [r.slug, r.warnedAt])).toEqual([["warned", 5]]);
  });
});

describe("an org the sweep warned (#344 review)", () => {
  const createLink = async (cookie: string, destination: string) => {
    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/links", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destination }),
      }),
      testEnv,
    );
    expect(res.status).toBe(201);
    const { id } = await jsonBody<{ id: string }>(res);
    return env.DB.prepare("select warned_at, warn_reason from links where id = ?")
      .bind(id)
      .first<{ warned_at: number | null; warn_reason: string | null }>();
  };

  it("makes new links warned too, until an admin marks it reviewed", async () => {
    const owner = await freeOwnerCookie();
    await warnOrgLinks(testEnv, db(), "org-1", WARN_REASON.traffic);

    // A fresh link is no way round the warning page.
    const born = await createLink(owner, "https://example.com/fresh");
    expect(born?.warned_at).not.toBeNull();
    expect(born?.warn_reason).toBe(WARN_REASON.traffic);

    const admin = await adminCookie();
    const reviewed = await fetchWorker(
      new Request("http://localhost/api/admin/links/orgs/org-1/reviewed", {
        method: "POST",
        headers: { cookie: admin },
      }),
    );
    expect(reviewed.status).toBe(200);
    expect((await createLink(owner, "https://example.com/after"))?.warned_at).toBeNull();
  });
});
