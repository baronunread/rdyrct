import type { ReactElement } from "react";
import { lookup } from "@/shared/lookup";
import { useLocation } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, Menu as MenuIcon } from "lucide-react";
// MorphIcon animates between two icons, so it takes lucide icon nodes, not
// the React components lucide-react exports.
import { Moon, Sun } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useTheme } from "../lib/theme";
import { appNavItems } from "./nav-items";
import { IconButton } from "../ui/button";
import { cn } from "../ui/cn";
import { Card } from "../ui/misc";
import { Skeleton, SkeletonStatus, TableSkeleton } from "../ui/skeleton";

/**
 * Page-level loading skeletons, one per route, used both as the lazy chunk's
 * Suspense fallback and as the route's own loading state so a page shows one
 * shape from first paint to content.
 *
 * The rule they follow: **draw only what the page is certain to render, in
 * the order it renders it.** Anything conditional is left out. Content
 * arriving below what is already on screen moves nothing, while a
 * placeholder for something that never arrives moves everything above it
 * when it disappears. Two of these used to guess: the dashboard drew stat
 * cards and five list cards at an account whose first-run page is a header
 * and one field, and analytics drew four bar lists where the real page puts
 * a three-column breakdown.
 */

/**
 * Stands in for PageHeader, which every route opens with, so its height has
 * to match exactly or the page below it moves on every route.
 *
 * Measured against the real thing on a populated account: the block is 52px
 * tall, an h1 at text-lg (28px line box) over a `mt-1` sub at text-sm (20px),
 * with `mb-6` under it. The bars are shorter than the text they replace, so
 * each sits in a box of the line's height rather than setting it.
 *
 * `action` mirrors the controls a page hangs on the right: 36px for a button
 * (Links, Members), 32px for the range picker and export pair (Analytics).
 * Leaving it out was why a header looked half-finished until the page landed.
 */
export function HeaderSkeleton({ action }: { action?: { w: string; h?: string } } = {}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <span className="flex h-7 items-center">
          <Skeleton className="h-5 w-40" />
        </span>
        <span className="mt-1 flex h-5 items-center">
          <Skeleton className="h-3 w-64 max-w-full" />
        </span>
      </div>
      {action && <Skeleton className={cn("rounded-lg", action.h ?? "h-9", action.w)} />}
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
        // 109 tall on a real page: the label line (17), the value (32) and
        // the delta under it, inside p-4.
        <div key={i} className="rounded-lg bg-surface p-4 smooth-shadow-ring-xs">
          <span className="flex h-[17px] items-center">
            <Skeleton className="h-2.5 w-16" />
          </span>
          <span className="mt-2 flex h-8 items-center">
            <Skeleton className="h-6 w-20" />
          </span>
          <span className="mt-1 flex h-4 items-center">
            <Skeleton className="h-2.5 w-12" />
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartCardSkeleton() {
  return (
    <Card>
      <Skeleton className="mb-3 h-2.5 w-24" />
      {/* the real AreaChart with its paddings: the card measures 241 */}
      <Skeleton className="h-[187px] w-full" />
    </Card>
  );
}

const barListRows = [64, 42, 78, 55, 71, 38, 60, 47, 83, 51];

function BarListCardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      <Skeleton className="mb-4 h-2.5 w-20" />
      <div className="flex flex-col gap-3.5">
        {barListRows.slice(0, rows).map((w) => (
          <div key={w}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <Skeleton className="h-3" style={{ width: `${w}%` }} />
              <Skeleton className="h-3 w-8 shrink-0" />
            </div>
            <Skeleton className="h-1.5 rounded-full" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * /dashboard, measured against a populated account: header (52), the
 * create card (68), the three stat cards (109), the clicks-and-activity
 * pair (245) and the three list cards (231).
 *
 * An account on its very first run has only the first two, so it watches the
 * rest disappear once. Every visit after that, and every visit by everyone
 * else, lands on the shape already drawn, which is the trade worth making.
 */
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
        <BarListCardSkeleton rows={5} />
        <BarListCardSkeleton rows={5} />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BarListCardSkeleton rows={5} />
        <BarListCardSkeleton rows={5} />
        <BarListCardSkeleton rows={5} />
      </div>
    </SkeletonStatus>
  );
}

/**
 * /analytics, block for block: the range picker and export pair in the
 * header, three stat cards (109), the clicks chart (241), the UTM trio
 * (231), top links (339), the country and referrer breakdown (765), dead
 * and decaying links (169), and the heatmap (343).
 *
 * All of it renders for any organization with clicks, so drawing half the
 * page (which is what four bar lists in a two-column grid amounted to) left
 * the second half arriving as a jump.
 */
export function AnalyticsSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton action={{ w: "w-72", h: "h-8" }} />
      <StatCardsSkeleton count={3} />
      <div className="mt-4">
        <ChartCardSkeleton />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BarListCardSkeleton rows={5} />
        <BarListCardSkeleton rows={5} />
        <BarListCardSkeleton rows={5} />
      </div>
      <div className="mt-4">
        <BarListCardSkeleton rows={7} />
      </div>
      {/* countries (a map card, 411) over referrers and devices (339) */}
      <div className="mt-4 flex flex-col gap-4">
        <Card>
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-4 h-[407px] w-full" />
        </Card>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BarListCardSkeleton rows={7} />
          <BarListCardSkeleton rows={7} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarListCardSkeleton rows={3} />
        <BarListCardSkeleton rows={3} />
      </div>
      {/* the heatmap, 343 */}
      <div className="mt-4">
        <Card>
          <Skeleton className="h-2.5 w-32" />
          <Skeleton className="mt-4 h-[290px] w-full" />
        </Card>
      </div>
    </SkeletonStatus>
  );
}

/** /admin: header, 6 stat cards, two charts, two ranked lists. */
export function AdminUsageSkeleton() {
  return (
    <SkeletonStatus testId="admin-usage-skeleton">
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
    <div data-testid="admin-table-skeleton">
      <HeaderSkeleton />
      <Skeleton className="mb-4 h-9 w-full max-w-xs" />
      <TableSkeleton rows={6} />
    </div>
  );
}

/** /admin/audit after its real header and search box have already rendered. */
export function AdminAuditRowsSkeleton() {
  return <TableSkeleton rows={6} testId="admin-audit-rows-skeleton" />;
}

/** Generic content placeholder for route guards (e.g. RequireAdmin). */
function PageSkeleton() {
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
          <div className="overflow-hidden rounded-lg bg-surface smooth-shadow-ring-xs">
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
            <MorphIcon icon={theme === "dark" ? Sun : Moon} size={15} spring="snappy" />
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
    <div className="flex min-h-dvh" data-testid="app-shell-skeleton">
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
          {/* whichever page was asked for, not always the dashboard */}
          <RouteSkeleton />
        </div>
      </main>
    </div>
  );
}

/**
 * /links, measured: header with the count-and-button pair on the right (52),
 * the search and domain-filter toolbar (36, `mb-4`), the table, and the
 * pager under it (24, `mt-4`). The toolbar was missing, so the table used to
 * arrive 36px lower than the skeleton had promised.
 */
export function LinksSkeleton() {
  return (
    <div data-testid="links-page-skeleton">
      <HeaderSkeleton action={{ w: "w-60" }} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-9 w-32" />
      </div>
      <TableSkeleton rows={12} />
      <div className="mt-4 flex justify-center">
        <Skeleton className="h-6 w-48" />
      </div>
    </div>
  );
}

/**
 * /members: header with the invite button (52), the invite-by-email card
 * (119), then the table. The card is the part that was missing.
 */
export function MembersSkeleton() {
  return (
    <div data-testid="members-page-skeleton">
      <HeaderSkeleton action={{ w: "w-36" }} />
      <Card className="mb-4">
        <Skeleton className="h-2.5 w-28" />
        {/* the label over the field, then the field and its button: 17 + 58
            inside the card's padding is the 119 the real one measures */}
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-2.5 w-12" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Skeleton className="h-9 min-w-0 flex-1" />
            <Skeleton className="h-9 sm:w-28" />
          </div>
        </div>
      </Card>
      <TableSkeleton rows={12} />
    </div>
  );
}

/**
 * /domains: header, then the two columns the page splits into on a wide
 * screen (the domains card and the how-it-works panel beside it).
 */
export function DomainsPageSkeleton() {
  return (
    <div data-testid="domains-page-skeleton">
      <HeaderSkeleton />
      <div className="flex flex-col gap-6 lg:flex-row">
        <Card className="min-w-0 flex-1">
          <Skeleton className="h-2.5 w-28" />
          <Skeleton className="mt-3 h-3 w-64 max-w-full" />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Skeleton className="h-9 min-w-0 flex-1" />
            <Skeleton className="h-9 sm:w-28" />
          </div>
          <div className="mt-4">
            <DomainsSkeleton />
          </div>
          <Skeleton className="mt-4 h-3 w-48" />
          <Skeleton className="mt-4 h-9 w-40" />
        </Card>
        {/* the how-it-works panel beside it: a label and the three steps
            HowItWorksSteps renders (domains.tsx). A fourth placeholder made
            the panel taller than the page it stands in for, so it shrank as
            the content arrived. */}
        <div className="lg:w-72">
          <Skeleton className="h-2.5 w-24" />
          <div className="mt-4 flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
                <Skeleton className="h-3 min-w-0 flex-1" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** /billing: header, the plan card, and the usage card beneath it. */
export function BillingSkeleton() {
  return (
    <SkeletonStatus testId="billing-page-skeleton">
      <HeaderSkeleton />
      {/* both cards are max-w-2xl on the real page: full-width placeholders
          were a third too wide, and the swap moved every edge */}
      <div className="flex flex-col gap-4">
        <Card className="max-w-2xl">
          <Skeleton className="h-2.5 w-12" />
          <Skeleton className="mt-3 h-5 w-40" />
          <Skeleton className="mt-3 h-3 w-72 max-w-full" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </Card>
        <Card className="max-w-2xl">
          <Skeleton className="h-2.5 w-28" />
          <div className="mt-3 flex flex-col gap-1">
            {[32, 36, 28, 30].map((w) => (
              <span key={w} className="flex h-5 items-center">
                <Skeleton className="h-3.5" style={{ width: `${w * 0.25}rem` }} />
              </span>
            ))}
          </div>
        </Card>
      </div>
    </SkeletonStatus>
  );
}

/**
 * /settings: header over the stack of cards (organization name, QR defaults,
 * then the account and danger-zone blocks).
 */
export function SettingsSkeleton() {
  return (
    <SkeletonStatus testId="settings-page-skeleton">
      <HeaderSkeleton />
      {/* the three cards, at the heights they measure: the name form (216),
          the QR defaults with its preview (656), and the danger zone (270) */}
      <div className="flex flex-col gap-4">
        <Card className="max-w-2xl">
          <Skeleton className="h-2.5 w-32" />
          <div className="mt-5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="mt-2 h-9 w-full max-w-sm" />
          </div>
          <Skeleton className="mt-5 h-9 w-32" />
          <Skeleton className="mt-5 h-3 w-56" />
        </Card>
        {/* QR defaults, 656: the label pair beside the 160x185 preview, then
            the colour, background and logo fields full width under them, then
            the save button. */}
        <Card className="max-w-2xl">
          {/* the card's own label (17) and its note (16) */}
          <span className="flex h-[17px] items-center">
            <Skeleton className="h-2.5 w-32" />
          </span>
          <span className="mt-1 flex h-4 items-center">
            <Skeleton className="h-3 w-64 max-w-full" />
          </span>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {[0, 1].map((i) => (
                <div key={i}>
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="mt-2 h-9 w-full" />
                </div>
              ))}
            </div>
            <Skeleton className="h-[185px] w-full shrink-0 sm:w-40" />
          </div>
          <div className="mt-4 flex flex-col gap-4">
            <div>
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="mt-2 h-9 w-full" />
            </div>
            <div>
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="mt-2 h-9 w-full" />
              <Skeleton className="mt-2 h-4 w-40" />
              <Skeleton className="mt-2 h-4 w-28" />
            </div>
            <div>
              <Skeleton className="h-2.5 w-10" />
              <Skeleton className="mt-2 h-9 w-full" />
              <Skeleton className="mt-2 h-4 w-56" />
              <Skeleton className="mt-2 h-4 w-44" />
              <Skeleton className="mt-2 h-4 w-32" />
            </div>
          </div>
          <Skeleton className="mt-5 h-9 w-full" />
        </Card>
        <Card className="max-w-2xl">
          <Skeleton className="h-2.5 w-24" />
          {[0, 1].map((i) => (
            <div key={i} className="mt-6">
              <Skeleton className="h-3 w-full max-w-md" />
              <Skeleton className="mt-2 h-3 w-3/5" />
              <Skeleton className="mt-4 h-9 w-40" />
            </div>
          ))}
        </Card>
      </div>
    </SkeletonStatus>
  );
}

/** /links/:slug: header, the clicks chart, and the addresses table. */
export function LinkDetailSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton action={{ w: "w-40" }} />
      <ChartCardSkeleton />
      <div className="mt-4">
        <TableSkeleton rows={3} />
      </div>
    </SkeletonStatus>
  );
}

/**
 * The skeleton a path stands behind.
 *
 * One map, because three different gates need the same answer: the shell
 * while the user query resolves, the Suspense boundary while a route's chunk
 * downloads, and the admin guard. They each used to answer with something
 * generic, so a cold load of /links opened with a dashboard (a create field
 * and three stat cards), then a table, then the page.
 */
const PAGE_SKELETONS = {
  "/dashboard": DashboardSkeleton,
  "/analytics": AnalyticsSkeleton,
  "/links": LinksSkeleton,
  "/members": MembersSkeleton,
  "/domains": DomainsPageSkeleton,
  "/billing": BillingSkeleton,
  "/settings": SettingsSkeleton,
  "/admin": AdminUsageSkeleton,
} satisfies Record<string, () => ReactElement>;

function skeletonFor(pathname: string): () => ReactElement {
  // The two routes with something after the prefix: an admin tab is a table,
  // and a single link is its own page.
  if (pathname.startsWith("/admin/")) return AdminTableSkeleton;
  if (pathname.startsWith("/links/")) return LinkDetailSkeleton;
  return lookup(PAGE_SKELETONS, pathname) ?? PageSkeleton;
}

/** The same thing for callers that are inside the router and have no path in
 * hand, which is all of them. */
export function RouteSkeleton() {
  const Page = skeletonFor(useLocation().pathname);
  return <Page />;
}
