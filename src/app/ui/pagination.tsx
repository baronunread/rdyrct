import { Button } from "./button";
import { cn } from "./cn";

// The total is optional: a cursor-paged endpoint does not count the table, and that count is
// the expensive query the paging moved away from.
export function CursorPager({
  page,
  pageSize,
  rows,
  total,
  hasNext,
  onBack,
  onNext,
  className,
}: {
  page: number;
  pageSize: number;
  rows: number;
  total?: number;
  hasNext: boolean;
  onBack: () => void;
  onNext: () => void;
  className?: string;
}) {
  if (rows === 0) return null;
  const n = (v: number) => v.toLocaleString("en-US");
  const from = page * pageSize + 1;
  const to = page * pageSize + rows;
  const single = page === 0 && !hasNext;
  return (
    <div className={cn("flex min-h-12 items-center justify-between gap-3 px-4 py-2", className)}>
      <span className="tnum text-xs text-muted">
        {n(from)} to {n(to)}
        {total !== undefined && total >= to ? ` of ${n(total)}` : ""}
      </span>
      {!single && (
        <span className="flex gap-1.5">
          <Button size="sm" onClick={onBack} disabled={page === 0}>
            Previous
          </Button>
          <Button size="sm" onClick={onNext} disabled={!hasNext}>
            Next
          </Button>
        </span>
      )}
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
        className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted transition-[color,scale] duration-200 ease-out enabled:active:scale-[0.96] [@media(hover:hover)]:hover:text-text disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-xs text-muted tnum">
        Page {page + 1} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange((p) => Math.min(totalPages - 1, p + 1))}
        disabled={page >= totalPages - 1}
        className="cursor-pointer rounded-md px-2.5 py-1 text-xs text-muted transition-[color,scale] duration-200 ease-out enabled:active:scale-[0.96] [@media(hover:hover)]:hover:text-text disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
