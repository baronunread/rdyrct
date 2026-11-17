import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-surface-2", className)}
      {...props}
    />
  );
}

export function SkeletonStatus({
  label = "loading…",
  className,
  testId,
  children,
}: {
  label?: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" className={className} data-testid={testId}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

const firstColWidths = [22, 30, 18, 26, 34, 24];

export function TableSkeleton({ rows = 4, testId }: { rows?: number; testId?: string }) {
  return (
    <div
      role="status"
      className="overflow-hidden rounded-lg bg-surface smooth-shadow-ring-xs"
      data-testid={testId}
    >
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
