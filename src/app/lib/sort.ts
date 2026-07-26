import type { Sort } from "@/shared/types";

/** Null-safe comparison for one sort column: nulls sort last regardless of
 * direction, otherwise strings/numbers compare normally scaled by `dir`. */
function compareSortValues(
  va: string | number | null,
  vb: string | number | null,
  dir: Sort["dir"],
): number {
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
  return cmp * dir;
}

export function sortRows<T>(
  rows: T[],
  sort: Sort,
  getters: Record<string, (r: T) => string | number | null>,
): T[] {
  const get = getters[sort.key];
  if (!get) return rows;
  return [...rows].sort((a, b) => compareSortValues(get(a), get(b), sort.dir));
}
