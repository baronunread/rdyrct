import { ChevronsUpDown, LogOut, Menu as MenuIcon, Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";
import { appNavItems } from "./nav-items";
import { IconButton } from "../ui/button";
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
        <div key={i} className="rounded-lg border border-border bg-surface p-4">
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
            <Skeleton className="h-1.5 rounded-full" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** /dashboard: header, quick-create card, 3 stat cards, 2 feed cards, 3 list cards. */
export function DashboardSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton />
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Skeleton className="h-9 min-w-0 flex-1" />
          <Skeleton className="h-9 sm:w-24" />
        </div>
      </Card>
      <div className="mt-4">
        <StatCardsSkeleton count={3} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarListCardSkeleton />
        <BarListCardSkeleton />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BarListCardSkeleton />
        <BarListCardSkeleton />
        <BarListCardSkeleton />
      </div>
    </SkeletonStatus>
  );
}

/** /analytics: header, 3 stat cards, clicks chart, 2×2 ranked lists. */
export function AnalyticsSkeleton() {
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
export function AdminUsageSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton />
      <StatCardsSkeleton count={6} gridClass="grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" />
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

/**
 * Sidebar for the loading shell. Everything static renders for real (brand,
 * nav, theme toggle — which already works, theme needs no user data); only
 * the data renders as skeleton bars: the org name and the user identity.
 * Fixed-height wrappers keep each bar as tall as the text line it stands in,
 * so the loaded sidebar replaces this without anything moving. Classes
 * mirror AppShell's sidebar.
 */
function SidebarSkeleton() {
  const [theme, toggleTheme] = useTheme();
  return (
    <div className="flex h-full flex-col">
      <div className="hidden px-3 pt-4 pb-2 md:block">
        <span className="px-1.5 text-sm font-bold tracking-widest">rdyrct</span>
      </div>

      {/* org switcher: the frame is chrome, the org name is data */}
      <div className="px-3 py-2">
        <div className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
          <span className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-28" />
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-muted" />
        </div>
      </div>

      {/* nav: real labels and icons, inert until the shell mounts */}
      <nav className="flex flex-col gap-0.5 px-3 py-2">
        {appNavItems.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted"
          >
            <Icon size={15} /> {label}
          </span>
        ))}
      </nav>

      {/* user footer: name and email are data, the theme toggle is live */}
      <div className="mt-auto border-t border-border px-3 py-2.5">
        <div className="flex items-center gap-2 px-1.5">
          <div className="min-w-0 flex-1">
            <span className="flex h-5 items-center">
              <Skeleton className="h-3 w-2/3" />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-2.5 w-4/5" />
            </span>
          </div>
          <IconButton label="Toggle theme" className="p-2" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </IconButton>
          <IconButton label="Sign out" danger className="p-2" disabled>
            <LogOut size={15} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/** First paint of the authenticated app: real sidebar chrome + skeleton
 * content. Layout classes mirror AppShell so the swap doesn't shift. */
export function AppShellSkeleton() {
  return (
    <div className="flex min-h-dvh">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-60 border-r border-border bg-surface/40 md:block">
        <SidebarSkeleton />
      </aside>

      {/* mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-border bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
        <span className="p-1.5 text-muted">
          <MenuIcon size={18} />
        </span>
        <span className="text-sm font-bold tracking-widest">rdyrct</span>
      </div>

      <main className="flex min-w-0 flex-1 flex-col px-5 py-8 pt-16 md:ml-60 md:px-8 md:pt-8">
        <div className="mx-auto w-full max-w-5xl flex-1">
          {/* mirrors /dashboard, the default landing after login */}
          <SkeletonStatus>
            <HeaderSkeleton />
            <Card>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Skeleton className="h-9 min-w-0 flex-1" />
                <Skeleton className="h-9 sm:w-24" />
              </div>
            </Card>
            <div className="mt-4">
              <StatCardsSkeleton count={3} />
            </div>
          </SkeletonStatus>
        </div>
      </main>
    </div>
  );
}
