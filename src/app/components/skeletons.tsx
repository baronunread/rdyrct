import { cn } from "../ui/cn";
import { Card } from "../ui/misc";
import { Skeleton, SkeletonStatus, TableSkeleton } from "../ui/skeleton";

/**
 * Page-level loading skeletons. Each mirrors its route's real layout so data
 * pops into place without a jump. The small blocks above stay private; routes
 * import the exported compositions.
 */

function HeaderSkeleton() {
  return (
    <div className="mb-6">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-2 h-3 w-64 max-w-full" />
    </div>
  );
}

function StatCardsSkeleton({
  count,
  gridClass = "sm:grid-cols-3",
}: {
  count: number;
  gridClass?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-4", gridClass)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="mt-3 h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

function ChartCardSkeleton() {
  return (
    <Card>
      <Skeleton className="mb-3 h-2.5 w-24" />
      {/* same height as the real AreaChart, including its paddings */}
      <Skeleton className="h-[180px] w-full" />
    </Card>
  );
}

const barListRows = [64, 42, 78, 55];

function BarListCardSkeleton() {
  return (
    <Card>
      <Skeleton className="mb-4 h-2.5 w-20" />
      <div className="flex flex-col gap-2.5">
        {barListRows.map((w) => (
          <div key={w}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <Skeleton className="h-2.5" style={{ width: `${w}%` }} />
              <Skeleton className="h-2.5 w-8 shrink-0" />
            </div>
            <Skeleton
              className="h-1.5 rounded-full"
              style={{ width: `${w}%` }}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** /dashboard: header, 3 stat cards, clicks chart, 2×2 ranked lists. */
export function DashboardSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton />
      <StatCardsSkeleton count={3} />
      <div className="mt-4">
        <ChartCardSkeleton />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarListCardSkeleton />
        <BarListCardSkeleton />
        <BarListCardSkeleton />
        <BarListCardSkeleton />
      </div>
    </SkeletonStatus>
  );
}

/** /admin: header, 6 stat cards, two charts, two ranked lists. */
export function AdminOverviewSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton />
      <StatCardsSkeleton
        count={6}
        gridClass="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
        <BarListCardSkeleton />
        <BarListCardSkeleton />
      </div>
    </SkeletonStatus>
  );
}

/** /admin/orgs and /admin/users: header, search box, big table. */
export function AdminTableSkeleton() {
  return (
    <div>
      <HeaderSkeleton />
      <Skeleton className="mb-4 h-9 w-full max-w-xs" />
      <TableSkeleton rows={6} />
    </div>
  );
}

/** Generic content placeholder for route guards (e.g. RequireAdmin). */
export function PageSkeleton() {
  return (
    <div>
      <HeaderSkeleton />
      <TableSkeleton rows={5} />
    </div>
  );
}

/** Domains card body: a couple of hostname rows with status pills. */
const domainRows = [40, 55];

export function DomainsSkeleton() {
  return (
    <SkeletonStatus className="flex flex-col gap-4">
      {domainRows.map((w) => (
        <div key={w} className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
            <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
          </div>
        </div>
      ))}
    </SkeletonStatus>
  );
}

/** Admin org dialog: chart plus the members and links tables. */
const detailTables = ["w-16", "w-12"];

export function OrgDetailSkeleton() {
  return (
    <SkeletonStatus className="flex flex-col gap-4">
      <ChartCardSkeleton />
      {detailTables.map((labelW) => (
        <div key={labelW}>
          <Skeleton className={cn("mb-2 h-2.5", labelW)} />
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {[0, 1, 2].map((r) => (
              <div
                key={r}
                className="flex items-center gap-6 border-b border-border/50 px-4 py-3.5 last:border-b-0"
              >
                <Skeleton className="h-3 w-1/4 shrink-0" />
                <Skeleton className="h-3 min-w-0 flex-1" />
                <Skeleton className="h-3 w-12 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonStatus>
  );
}

/** /invite: text and action button inside the existing card. */
export function InviteSkeleton() {
  return (
    <SkeletonStatus className="flex flex-col items-center gap-3">
      <Skeleton className="h-3 w-4/5" />
      <Skeleton className="h-3 w-3/5" />
      <Skeleton className="mt-2 h-9 w-full" />
    </SkeletonStatus>
  );
}

/** First paint of the authenticated app: sidebar chrome + main content. */
export function AppShellSkeleton() {
  return (
    <SkeletonStatus>
      <div className="flex min-h-dvh">
        {/* desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-surface/40 md:block">
          <div className="flex h-full flex-col">
            <div className="px-3 pt-4 pb-2">
              <Skeleton className="mx-1.5 h-4 w-16" />
            </div>
            <div className="px-3 py-2">
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="flex flex-col gap-1.5 px-3 py-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
            <div className="mt-auto border-t border-border px-3 py-2.5">
              <div className="px-1.5">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="mt-1.5 h-2.5 w-4/5" />
              </div>
            </div>
          </div>
        </aside>

        {/* mobile top bar */}
        <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-border bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-6 w-6" />
        </div>

        <main className="flex min-w-0 flex-1 flex-col px-5 py-8 pt-16 md:px-8 md:pt-8">
          <div className="mx-auto w-full max-w-5xl flex-1">
            <HeaderSkeleton />
            <StatCardsSkeleton count={3} />
            <div className="mt-4">
              <ChartCardSkeleton />
            </div>
          </div>
        </main>
      </div>
    </SkeletonStatus>
  );
}
