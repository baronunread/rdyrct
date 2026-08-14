/**
 * Next and back over a cursor-paged list.
 *
 * No total, because a cursor-paged endpoint does not count the table to hand
 * one over: that count is the expensive query the paging was moved away
 * from, and it is stale the moment it is read. The page number is what the
 * reader is actually keeping track of.
 */
export function CursorPager({
  page,
  hasNext,
  onBack,
  onNext,
}: {
  page: number;
  hasNext: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  if (page === 0 && !hasNext) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={onBack}
        disabled={page === 0}
        className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted transition-[color,scale] duration-150 enabled:active:scale-[0.96] hover:text-text disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-xs text-muted tnum">Page {page + 1}</span>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext}
        className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted transition-[color,scale] duration-150 enabled:active:scale-[0.96] hover:text-text disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (fn: (p: number) => number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => onPageChange((p) => Math.max(0, p - 1))}
        disabled={page === 0}
        className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted transition-[color,scale] duration-150 enabled:active:scale-[0.96] hover:text-text disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-xs text-muted tnum">
        {page + 1} / {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange((p) => Math.min(totalPages - 1, p + 1))}
        disabled={page >= totalPages - 1}
        className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted transition-[color,scale] duration-150 enabled:active:scale-[0.96] hover:text-text disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
