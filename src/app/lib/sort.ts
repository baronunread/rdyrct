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
  // A column holds numbers or text, never a mix. Number.isFinite does not
  // coerce, so "10" stays text and sorts the way it is shown.
  const cmp =
    Number.isFinite(va) && Number.isFinite(vb)
      ? Number(va) - Number(vb)
      : String(va).localeCompare(String(vb));
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
