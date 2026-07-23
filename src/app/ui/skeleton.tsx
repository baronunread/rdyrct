import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Base loading placeholder: a pulsing, surface-colored block. Compose these
 * into skeletons that mirror the layout of the content being loaded, so real
 * data pops into place without the page jumping.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-surface-2", className)}
      {...props}
    />
  );
}

/** Live-region wrapper so skeletons are announced like the old spinner was. */
export function SkeletonStatus({
  label = "loading…",
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/* organic variance for the first column, deterministic across renders */
const firstColWidths = [22, 30, 18, 26, 34, 24];

/** Placeholder for a data Table: a header row plus `rows` body rows. */
export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" className="overflow-hidden rounded-lg border border-border bg-surface">
      <span className="sr-only">loading…</span>
      <div className="flex items-center gap-6 border-b border-border px-4 py-3">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-2.5 w-12" />
        <Skeleton className="ml-auto h-2.5 w-10" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-border/50 px-4 py-4 last:border-b-0"
        >
          <Skeleton
            className="h-3 shrink-0"
            style={{ width: `${firstColWidths[i % firstColWidths.length]}%` }}
          />
          <Skeleton className="h-3 min-w-0 flex-1" />
          <Skeleton className="h-3 w-10 shrink-0" />
          <Skeleton className="h-3 w-16 shrink-0 max-sm:hidden" />
        </div>
      ))}
    </div>
  );
}
