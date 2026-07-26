import { describe, expect, test } from "bun:test";
import { sortRows } from "../src/app/lib/sort";

type Row = { id: string; name: string | null; count: number | null };

const rows: Row[] = [
  { id: "a", name: "Charlie", count: 3 },
  { id: "b", name: "Alice", count: null },
  { id: "c", name: "Bob", count: 1 },
];

const getters = {
  name: (r: Row) => r.name,
  count: (r: Row) => r.count,
};

describe("sortRows", () => {
  test("sorts strings ascending", () => {
    const sorted = sortRows(rows, { key: "name", dir: 1 }, getters);
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  test("sorts strings descending", () => {
    const sorted = sortRows(rows, { key: "name", dir: -1 }, getters);
    expect(sorted.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  test("nulls always sort last, regardless of direction", () => {
    const asc = sortRows(rows, { key: "count", dir: 1 }, getters);
    expect(asc.at(-1)!.id).toBe("b");
    const desc = sortRows(rows, { key: "count", dir: -1 }, getters);
    expect(desc.at(-1)!.id).toBe("b");
  });

  test("sorts numbers ascending", () => {
    const sorted = sortRows(rows, { key: "count", dir: 1 }, getters);
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  test("unknown sort key returns rows unchanged", () => {
    expect(sortRows(rows, { key: "nope", dir: 1 }, getters)).toBe(rows);
  });
});
