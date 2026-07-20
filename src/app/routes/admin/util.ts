export const linkLabel = (l: { domain: string | null; slug: string }) =>
  l.domain ? `${l.domain}/${l.slug}` : `/${l.slug}`;

export type Sort = { key: string; dir: 1 | -1 };

export function sortRows<T>(
  rows: T[],
  sort: Sort,
  getters: Record<string, (r: T) => string | number | null>,
): T[] {
  const get = getters[sort.key];
  if (!get) return rows;
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1; // nulls always sink to the bottom
    if (vb == null) return -1;
    const cmp =
      typeof va === "string"
        ? va.localeCompare(vb as string)
        : va - (vb as number);
    return cmp * sort.dir;
  });
}
