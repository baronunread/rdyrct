/**
 * Import from another service (#383): the rows the browser read from a
 * Short.io, Bitly, Rebrandly or Dub export become links on the same domain and
 * slug, and each short URL then sends people where it used to.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, authEnv, fetchWorker, freeOwnerCookie, jsonBody } from "./support";
import type { ImportVerdict } from "../../src/shared/link-import";
import { PLAN_LIMITS } from "../../src/shared/types";
import { enqueueStorage, syncDomainMsg } from "../../src/worker/storage";
import { finishImport, importNextChunk, stopImport } from "../../src/worker/routes/link-import";
import type { JsonValue } from "../../src/shared/types";
import type { LinkImportDTO } from "../../src/shared/link-import";

const HOST = "short.example";
let cookie: string;

beforeEach(async () => {
  await applyTestMigrations();
  cookie = await freeOwnerCookie({ id: "dom-1", hostname: HOST });
  await setPlan("hobby");
  // Activation publishes a domain to KV, which is all a custom host's
  // redirect reads; the seeded row skipped activation.
  await enqueueStorage(authEnv(), [syncDomainMsg(HOST)]);
});

afterEach(reset);

async function setPlan(plan: "free" | "hobby") {
  await env.DB.prepare("update user set plan = ?, comp_plan = ? where id = 'free-1'")
    .bind(plan, plan === "free" ? null : plan)
    .run();
}

type Row = { line: number; host: string; slug: string; destination: string; title?: string };

const row = (line: number, slug: string, destination: string, host = HOST): Row => ({
  line,
  host,
  slug,
  destination,
});

async function post(step: "check" | "run", rows: Row[]) {
  return fetchWorker(
    new Request(`http://localhost/api/orgs/org-1/link-import/${step}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ rows }),
    }),
  );
}

async function verdicts(step: "check" | "run", rows: Row[]) {
  if (step === "run") return runImport(rows);
  const res = await post(step, rows);
  expect(res.status).toBe(200);
  return (await jsonBody<{ verdicts: ImportVerdict[]; room?: number }>(res)).verdicts;
}

async function call(method: string, path: string, body?: JsonValue, testEnv = authEnv()) {
  return fetchWorker(
    new Request(`http://localhost/api/orgs/org-1/link-import${path}`, {
      method,
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    testEnv,
  );
}

/** An import the way the page runs one: create it, send the rows, start it,
 * then the workflow's steps until nothing is pending. Returns each row's
 * outcome as the page reads it. */
async function runImport(rows: Row[]): Promise<ImportVerdict[]> {
  const created = await call("POST", "", { service: "shortio", total: rows.length });
  expect(created.status).toBe(201);
  const { id } = await jsonBody<{ id: string }>(created);
  expect((await call("POST", `/${id}/rows`, { rows })).status).toBe(200);
  expect((await call("POST", `/${id}/start`)).status).toBe(200);
  await drain(id);
  const result = await env.DB.prepare(
    "select line, status, reason from link_import_rows where import_id = ? order by line",
  )
    .bind(id)
    .all<{ line: number; status: ImportVerdict["status"]; reason: string }>();
  return result.results.map(({ line, status, reason }) =>
    reason ? { line, status, reason } : { line, status },
  );
}

/** A one-row import with its row sent, not yet started. */
async function uploaded() {
  const created = await call("POST", "", { service: "dub", total: 1 });
  const { id } = await jsonBody<{ id: string }>(created);
  await call("POST", `/${id}/rows`, { rows: [row(2, "a", "https://example.com/a")] });
  return id;
}

/** What LinkImportWorkflow does, step by step. */
async function drain(id: string) {
  while ((await importNextChunk(authEnv(), id)) > 0);
  await finishImport(authEnv(), id);
}

const follow = (url: string) =>
  fetchWorker(
    new Request(url, { redirect: "manual", headers: { host: new URL(url).host } }),
    authEnv(),
  );

async function linkCount(): Promise<number> {
  const result = await env.DB.prepare(
    "select count(*) as n from links where org_id = 'org-1'",
  ).first<{
    n: number;
  }>();
  return result!.n;
}

describe("who can import", () => {
  it("refuses a free plan with a code the page can show an upgrade for", async () => {
    await setPlan("free");
    const res = await post("check", [row(2, "a", "https://example.com")]);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "import_locked" });
  });
});

describe("checking rows writes nothing and says why", () => {
  it("gives each row its verdict", async () => {
    const result = await verdicts("check", [
      row(2, "fnhdifh", "https://example.com/test/url/long?utm_source=ig"),
      row(3, "x", "https://example.com", "elsewhere.example"),
      row(4, "docs/api", "https://example.com"),
      row(5, "login", "https://example.com"),
      row(6, "fnhdifh", "https://example.com/other"),
      row(7, "bad", "notaurl"),
      row(8, "short", "https://bit.ly/abc"),
    ]);
    expect(result.map((verdict) => verdict.status)).toEqual([
      "ready",
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
      "failed",
    ]);
    expect(result.map((verdict) => verdict.reason ?? "")).toEqual([
      "",
      "elsewhere.example is not one of this organization's domains.",
      "The slug /docs/api uses characters we can't serve. Only letters, numbers, - and _ work here.",
      "/login is reserved here.",
      "The same short URL is on an earlier line.",
      "The destination is not a valid http(s) URL.",
      "The destination is another link shortener. Point the link at the final URL.",
    ]);
    expect(await linkCount()).toBe(0);
  });

  it("says how much room the plan has left", async () => {
    const res = await post("check", [row(2, "a", "https://example.com")]);
    expect(await jsonBody<{ room: number }>(res)).toMatchObject({ room: PLAN_LIMITS.hobby.links });
  });
});

describe("importing", () => {
  it("recreates the short URL, and it sends people where it used to", async () => {
    const original =
      "https://example.com/test/url/long?ref=a+b&utm_source=instagram&utm_campaign=Spring%20Sale";
    expect(await verdicts("run", [{ ...row(2, "fnhdifh", original), title: "Spring" }])).toEqual([
      { line: 2, status: "imported" },
    ]);

    const link = await env.DB.prepare(
      "select destination, title, utm_source, utm_campaign from links where slug = 'fnhdifh'",
    ).first();
    expect(link).toEqual({
      destination: "https://example.com/test/url/long?ref=a+b",
      title: "Spring",
      utm_source: "instagram",
      utm_campaign: "Spring Sale",
    });

    const res = await follow(`https://${HOST}/fnhdifh`);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://example.com/test/url/long");
    expect(location.search).toContain("ref=a+b");
    expect(location.searchParams.get("utm_source")).toBe("instagram");
    expect(location.searchParams.get("utm_campaign")).toBe("Spring Sale");
  });

  it("keeps the slug's case", async () => {
    await verdicts("run", [row(2, "Promo", "https://example.com/a")]);
    expect((await follow(`https://${HOST}/Promo`)).status).toBe(302);
  });

  it("imports the good rows of a chunk and reports the rest", async () => {
    const result = await verdicts("run", [
      row(2, "one", "https://example.com/1"),
      row(3, "two/x", "https://example.com/2"),
      row(4, "three", "https://example.com/3"),
    ]);
    expect(result.map((verdict) => verdict.status)).toEqual(["imported", "failed", "imported"]);
    expect(await linkCount()).toBe(2);
  });

  it("does not duplicate a row on retry", async () => {
    const rows = [row(2, "one", "https://example.com/1?utm_medium=email")];
    await verdicts("run", rows);
    expect(await verdicts("run", rows)).toEqual([{ line: 2, status: "exists" }]);
    expect(await linkCount()).toBe(1);
  });

  it("refuses a slug that already goes somewhere else", async () => {
    await verdicts("run", [row(2, "one", "https://example.com/1")]);
    const [verdict] = await verdicts("run", [row(9, "one", "https://example.com/changed")]);
    expect(verdict).toEqual({
      line: 9,
      status: "failed",
      reason: `/one on ${HOST} already goes somewhere else.`,
    });
  });

  it("stops at the plan's link cap, row by row", async () => {
    const room = 2;
    await fillTo(PLAN_LIMITS.hobby.links - room);
    const result = await verdicts("run", [
      row(2, "a", "https://example.com/a"),
      row(3, "b", "https://example.com/b"),
      row(4, "c", "https://example.com/c"),
    ]);
    expect(result.map((verdict) => verdict.status)).toEqual(["imported", "imported", "failed"]);
    expect(result[2].reason).toBe("Your plan has no room for more links.");
    expect(await linkCount()).toBe(PLAN_LIMITS.hobby.links);
  });
});

/** `count` links with their primary addresses on the shared domain, written
 * straight to D1: the cap counts active primary addresses. */
async function fillTo(count: number) {
  await env.DB.batch([
    env.DB.prepare(
      `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?)
       insert into links (id, org_id, slug, destination, title, utm_source, utm_medium, utm_campaign,
         utm_term, utm_content, qr_logo, qr_style, qr_color, qr_corner, qr_bg, qr_eye_color, created_at)
       select 'fill-' || i, 'org-1', 'fill' || i, 'https://example.com', '', '', '', '', '', '', '', '', '', '', '', '', 0 from n`,
    ).bind(count),
    env.DB.prepare(
      `with recursive n(i) as (select 1 union all select i + 1 from n where i < ?)
       insert into link_addresses (id, link_id, org_id, domain_id, slug, kind, creation_reason, created_at)
       select 'fill-addr-' || i, 'fill-' || i, 'org-1', null, 'fill' || i, 'primary', 'created', 0 from n`,
    ).bind(count),
  ]);
}

describe("an import runs on the server", () => {
  it("is still there when the page comes back, with its outcome", async () => {
    await runImport([
      row(2, "one", "https://example.com/1"),
      row(3, "x/y", "https://example.com/2"),
    ]);
    const res = await call("GET", "/current");
    const { import: job } = await jsonBody<{ import: LinkImportDTO }>(res);
    expect(job).toMatchObject({
      status: "done",
      total: 2,
      imported: 1,
      failed: 1,
      pending: 0,
      hosts: [HOST],
    });
    expect(job.failures).toHaveLength(1);
    expect(job.failures[0]).toMatchObject({ line: 3, slug: "x/y" });
  });

  it("will not start until every row has arrived", async () => {
    const created = await call("POST", "", { service: "dub", total: 2 });
    const { id } = await jsonBody<{ id: string }>(created);
    await call("POST", `/${id}/rows`, { rows: [row(2, "a", "https://example.com/a")] });
    const res = await call("POST", `/${id}/start`);
    expect(res.status).toBe(409);
    // The same file sent again fills the gap without doubling a row.
    await call("POST", `/${id}/rows`, {
      rows: [row(2, "a", "https://example.com/a"), row(3, "b", "https://example.com/b")],
    });
    expect((await call("POST", `/${id}/start`)).status).toBe(200);
  });

  it("refuses a second import while one is running", async () => {
    const id = await uploaded();
    await call("POST", `/${id}/start`);
    expect((await call("POST", "", { service: "dub", total: 1 })).status).toBe(409);
  });

  it("retries only the rows that failed", async () => {
    await fillTo(PLAN_LIMITS.hobby.links - 1);
    const rows = [row(2, "a", "https://example.com/a"), row(3, "b", "https://example.com/b")];
    expect((await runImport(rows)).map((v) => v.status)).toEqual(["imported", "failed"]);
    await env.DB.prepare("delete from link_addresses where id = 'fill-addr-1'").run();
    const { import: job } = await jsonBody<{ import: LinkImportDTO }>(
      await call("GET", "/current"),
    );
    expect((await call("POST", `/${job.id}/retry`)).status).toBe(200);
    await drain(job.id);
    const { import: after } = await jsonBody<{ import: LinkImportDTO }>(
      await call("GET", "/current"),
    );
    expect(after).toMatchObject({ status: "done", imported: 2, failed: 0 });
  });

  it("never sticks at running when the workflow cannot start", async () => {
    const id = await uploaded();
    const up = authEnv().LINK_IMPORT;
    const down = {
      ...authEnv(),
      LINK_IMPORT: {
        get: (id: string) => up.get(id),
        // bind, not a wrapper arrow: it keeps both createBatch overloads.
        createBatch: up.createBatch.bind(up),
        deleteBatch: (ids: Parameters<typeof up.deleteBatch>[0]) => up.deleteBatch(ids),
        create: async () => {
          throw new Error("injected workflow start failure");
        },
      },
    };
    expect((await call("POST", `/${id}/start`, undefined, down)).status).toBe(502);
    const { import: job } = await jsonBody<{ import: LinkImportDTO }>(
      await call("GET", "/current"),
    );
    expect(job).toMatchObject({ status: "done", pending: 0, failed: 1 });
    // Its failed row can go again, and the org is free to start another.
    expect((await call("POST", `/${id}/retry`)).status).toBe(200);
    await drain(id);
    expect((await call("POST", "", { service: "dub", total: 1 })).status).toBe(201);
  });

  it("ends an import whose workflow gave up, so the org can go on", async () => {
    const id = await uploaded();
    await call("POST", `/${id}/start`);
    await stopImport(authEnv(), id);
    const { import: job } = await jsonBody<{ import: LinkImportDTO }>(
      await call("GET", "/current"),
    );
    expect(job).toMatchObject({ status: "done", failed: 1 });
    expect((await call("POST", `/${id}/dismiss`)).status).toBe(200);
  });

  it("is never shown to another organization", async () => {
    await runImport([row(2, "a", "https://example.com/a")]);
    const { import: job } = await jsonBody<{ import: LinkImportDTO }>(
      await call("GET", "/current"),
    );
    // Another org's import, by id: org-1's routes must not reach it.
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values ('org-other', 'Other', 0)"),
      env.DB.prepare("update link_imports set org_id = 'org-other' where id = ?").bind(job.id),
    ]);
    const res = await call("POST", `/${job.id}/dismiss`);
    expect(res.status).toBe(404);
    expect(await jsonBody<{ import: LinkImportDTO | null }>(await call("GET", "/current"))).toEqual(
      {
        import: null,
      },
    );
  });
});
