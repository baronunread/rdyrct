export const linkLabel = (l: { domain: string | null; slug: string }) =>
  l.domain ? `${l.domain}/${l.slug}` : `/${l.slug}`;

const ADMIN_PAGE_SIZE = 25;

/** One page of an already-filtered list. `safePage` clamps a page number that
 * a narrowing search has left past the end, and one below the start: no
 * caller passes a negative page today, and a helper that answers with the
 * tail of the list when one does is worth one `Math.max`. */
export function paginate<T>(all: T[], page: number, size = ADMIN_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(all.length / size));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  return { totalPages, safePage, rows: all.slice(safePage * size, (safePage + 1) * size) };
}
