import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, fetchWorker, freeOwnerCookie } from "./support";

/**
 * Paging an organization's links against a real database (#19).
 *
 * The properties worth asserting are the ones offset cannot give you: a page
 * that does not repeat or skip a row when the table changes underneath it,
 * and a boundary that holds when two rows sort the same.
 */

interface Page {
  items: { id: string; slug: string; createdAt: number; clicks: number }[];
  nextCursor: string | null;
}

async function list(cookie: string, query = ""): Promise<Page> {
  const res = await fetchWorker(
    new Request(`http://localhost/api/orgs/org-1/links?${query}`, { headers: { cookie } }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

/** Rows straight into D1: what is under test is reading them back, and the
 * create route would re-derive slugs, publish to KV and score destinations. */
async function seedLinks(count: number, at: (i: number) => number) {
  for (let i = 0; i < count; i++)
    await env.DB.prepare(
      `insert into links (id, org_id, slug, destination, created_at)
       values (?, 'org-1', ?, ?, ?)`,
    )
      .bind(`link-${i}`, `slug-${String(i).padStart(3, "0")}`, `https://example.com/${i}`, at(i))
      .run();
}

/** Walks every page and returns the ids in the order they arrived. */
async function walk(cookie: string, query: string): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 20; guard++) {
    const page: Page = await list(
      cookie,
      `${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    seen.push(...page.items.map((l) => l.id));
    cursor = page.nextCursor;
    if (!cursor) return seen;
  }
  throw new Error("pagination did not terminate");
}

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

describe("paging an organization's links", () => {
  it("hands back a page and a cursor that continues it", async () => {
    const cookie = await freeOwnerCookie();
    await seedLinks(7, (i) => 1000 + i);

    const first = await list(cookie, "limit=3");
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBeTruthy();

    const second = await list(cookie, `limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items.map((l) => l.id)).not.toEqual(first.items.map((l) => l.id));
  });

  it("visits every link exactly once", async () => {
    const cookie = await freeOwnerCookie();
    await seedLinks(7, (i) => 1000 + i);

    const ids = await walk(cookie, "limit=3");

    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
  });

  it("does not repeat a row when a newer link arrives mid-walk", async () => {
    // The offset failure, in one test. A row inserted above the cursor
    // shifts every later row down by one, so `offset 3` reads a link the
    // first page already showed. A cursor names the row it continues from,
    // and rows arriving above it cannot move it.
    const cookie = await freeOwnerCookie();
    await seedLinks(6, (i) => 1000 + i);

    const first = await list(cookie, "limit=3");
    await env.DB.prepare(
      `insert into links (id, org_id, slug, destination, created_at)
       values ('link-new', 'org-1', 'newest', 'https://example.com/new', 9999)`,
    ).run();

    const second = await list(cookie, `limit=3&cursor=${encodeURIComponent(first.nextCursor!)}`);
    const overlap = second.items.filter((l) => first.items.some((f) => f.id === l.id));
    expect(overlap).toEqual([]);
  });

  it("keeps a boundary between links created in the same millisecond", async () => {
    // Every row shares a timestamp, so the id tiebreaker is the only thing
    // separating them. Without it the order is undefined between queries and
    // a page boundary drops one row and repeats another.
    const cookie = await freeOwnerCookie();
    await seedLinks(6, () => 5000);

    const ids = await walk(cookie, "limit=2");

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it("searches and filters in the query, not in the browser", async () => {
    // The browser holds one page now, so a search it ran itself would only
    // ever find what that page already showed.
    const cookie = await freeOwnerCookie();
    await seedLinks(30, (i) => 1000 + i);
    await env.DB.prepare("update links set destination = ? where id = 'link-0'")
      .bind("https://findme.example/x")
      .run();

    // link-0 is the oldest of thirty, so it is nowhere near the first page.
    const page = await list(cookie, "q=findme.example");

    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe("link-0");
  });

  it("sorts by slug and by clicks, and pages both", async () => {
    const cookie = await freeOwnerCookie();
    await seedLinks(5, (i) => 1000 + i);

    const bySlug = await walk(cookie, "limit=2&sort=slug&dir=asc");
    expect(bySlug).toEqual(["link-0", "link-1", "link-2", "link-3", "link-4"]);

    // Clicks are an aggregate, so its cursor carries the count rather than a
    // column: give one link some and it comes first.
    for (let i = 0; i < 3; i++)
      await env.DB.prepare("insert into clicks (link_id, org_id, ts) values ('link-2', 'org-1', ?)")
        .bind(2000 + i)
        .run();

    const byClicks = await walk(cookie, "limit=2&sort=clicks");
    expect(byClicks[0]).toBe("link-2");
    expect(byClicks).toHaveLength(5);
  });
});
