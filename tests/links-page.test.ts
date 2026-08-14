import { describe, expect, test } from "bun:test";
import { encodeCursor, readLinkPageParams, takePage, LINKS_PAGE_SIZE } from "@/worker/links-page";

/**
 * The paging rules on their own, away from a database.
 *
 * What these pin down is the part that decides correctness rather than
 * speed: what a caller is allowed to ask for, and how a page hands over the
 * cursor that continues it.
 */

const read = (query: string) => readLinkPageParams(new URL(`https://x/links?${query}`));

describe("what a caller may ask for", () => {
  test("defaults to the newest links, a page at a time", () => {
    const params = read("");
    expect(params).toMatchObject({
      limit: LINKS_PAGE_SIZE,
      sort: "created",
      dir: -1,
      cursor: null,
    });
  });

  test("caps the page size, since it decides how much work one request costs", () => {
    expect(read("limit=5000").limit).toBe(100);
    expect(read("limit=0").limit).toBe(1);
    expect(read("limit=-3").limit).toBe(1);
    expect(read("limit=notanumber").limit).toBe(LINKS_PAGE_SIZE);
  });

  test("ignores a sort it does not offer, rather than interpolating it", () => {
    expect(read("sort=slug").sort).toBe("slug");
    expect(read("sort=clicks").sort).toBe("clicks");
    expect(read("sort=created_at; drop table links").sort).toBe("created");
  });

  test("reads a cursor it issued", () => {
    const params = read(`cursor=${encodeURIComponent(encodeCursor(1700, "link-9"))}`);
    expect(params.cursor).toEqual({ value: 1700, id: "link-9" });
  });

  test("treats a cursor it cannot read as the first page", () => {
    // A kept URL with a stale or hand-edited cursor: the top of the list is
    // a better answer than a 400 about a parameter nobody typed.
    expect(read("cursor=not-base64").cursor).toBeNull();
    expect(read(`cursor=${btoa('{"nope":1}')}`).cursor).toBeNull();
    expect(read(`cursor=${btoa("[[1,2],3]")}`).cursor).toBeNull();
  });
});

describe("handing over the next page", () => {
  const params = { ...read(""), limit: 2 };
  const rows = [
    { id: "a", createdAt: 300 },
    { id: "b", createdAt: 200 },
    { id: "c", createdAt: 100 },
  ];

  test("keeps the extra row back and turns it into a cursor", () => {
    // The query asks for one more than the page. Whether that row exists is
    // how the last page is recognized, without counting the table.
    const page = takePage(rows, params, (r) => r.createdAt);
    expect(page.items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe(encodeCursor(200, "b"));
  });

  test("says so when there is no next page", () => {
    const page = takePage(rows.slice(0, 2), params, (r) => r.createdAt);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  test("cuts exactly at the page size, never a row early", () => {
    const page = takePage(rows.slice(0, 3), { ...params, limit: 3 }, (r) => r.createdAt);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });
});
