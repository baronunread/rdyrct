import type { OrgPlan } from "@/shared/types";
import type { ReactElement, ReactNode } from "react";
import { lookup } from "@/shared/lookup";
import { useLocation } from "@tanstack/react-router";
import { ChevronsUpDown, Menu as MenuIcon } from "@/app/ui/icons";
import { appNavItems } from "./nav-items";
import { cn } from "../ui/cn";
import { Card } from "../ui/misc";
import { Skeleton, SkeletonStatus, TableSkeleton } from "../ui/skeleton";
import { Logo, LogoMark } from "../ui/logo";
import { shellLayout, useSidebarCollapsed } from "../lib/sidebar";

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
 * An h1 at text-xl (28px line box), then, only where the page has one, a
 * `mt-1` sub at text-sm (20px), with `mb-6` under it. Settings, Organization,
 * Domains and the dashboard have no sub, so it is off unless asked for. The
 * bars are shorter than the text they replace, so each sits in a box of the
 * line's height rather than setting it.
 *
 * `action` is whatever the page hangs on the right, drawn at the size of the
 * real controls (`ButtonSkeleton` for a 36px button).
 */
export function HeaderSkeleton({
  sub = false,
  action,
}: { sub?: boolean; action?: ReactNode } = {}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <span className="flex h-7 items-center">
          <Skeleton className="h-5 w-40" />
        </span>
        {sub && (
          <span className="mt-1 flex h-5 items-center">
            <Skeleton className="h-3 w-64 max-w-full" />
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

/** A `md` Button (h-9, rounded-lg) at the width its label takes. */
function ButtonSkeleton({ className }: { className: string }) {
  return <Skeleton className={cn("h-9 shrink-0 rounded-lg", className)} />;
}

/** NewLinkButton: icon, "New link" and its `C` key, which hides on a phone. */
function NewLinkButtonSkeleton() {
  return <ButtonSkeleton className="w-[7.5rem] sm:w-[9.25rem]" />;
}

/**
 * StatsChart: the strip of figures over the chart in one card. Each figure is
 * a text-xs label over a text-xl leading-tight value (25px) in `px-2.5 py-2`,
 * the first one shaded; the chart sits in `px-4 pt-1 pb-3` at its own height.
 */
function StatsChartSkeleton({ figures, chartHeight }: { figures: number; chartHeight: number }) {
  return (
    <div className="rounded-xl bg-surface smooth-shadow-ring-xs">
      <div className="flex flex-wrap gap-1 p-1.5">
        {Array.from({ length: figures }, (_, i) => (
          <div
            key={i}
            className={cn(
              "flex min-w-[40%] flex-1 flex-col gap-0.5 rounded-lg px-2.5 py-2 sm:min-w-0",
              i === 0 && "bg-bg",
            )}
          >
            <span className="flex h-4 items-center">
              <Skeleton className="h-2.5 w-16" />
            </span>
            <span className="flex h-[25px] items-center">
              <Skeleton className="h-4 w-14" />
            </span>
          </div>
        ))}
      </div>
      <div className="px-4 pt-1 pb-3">
        <Skeleton className="w-full" style={{ height: chartHeight }} />
      </div>
    </div>
  );
}

/**
 * PanelTabs: underline tabs (`pb-2.5` under a 20px label) over a hairline,
 * `mb-3`, then the panel, all in `px-4 pt-3 pb-3.5`. `tabs` are the label
 * widths; `end` draws the quiet link some panels put on the right.
 */
function PanelSkeleton({
  tabs,
  end,
  children,
}: {
  tabs: string[];
  end?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface px-4 pt-3 pb-3.5 smooth-shadow-ring-xs">
      <div className="mb-3 flex items-center gap-4 shadow-[inset_0_-1px_0_var(--border)]">
        {/* Index keys: two tabs can share a width. The list never reorders. */}
        {tabs.map((w, i) => (
          // oxlint-disable-next-line react/no-array-index-key
          <span key={i} className="flex h-5 box-content items-center pb-2.5">
            <Skeleton className={cn("h-3", w)} />
          </span>
        ))}
        {end && (
          <span className="ml-auto flex h-4 box-content items-center pb-2.5">
            <Skeleton className="h-2.5 w-14" />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

const barWidths = [92, 71, 58, 44, 33, 24, 17];

/** BarList with column headings: a 20px heading row, then 30px bars
 * `gap-y-0.5` apart, the count and share in their own columns. */
function BarListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_2.5rem] items-center gap-x-3 gap-y-0.5">
      <span className="flex h-4 box-content items-center pb-1">
        <Skeleton className="h-2.5 w-10" />
      </span>
      <span className="flex h-4 box-content items-center justify-end pb-1">
        <Skeleton className="h-2.5 w-10" />
      </span>
      <span />
      {barWidths.slice(0, rows).map((w) => (
        <div key={w} className="contents">
          <Skeleton className="h-[30px]" style={{ width: `${w}%` }} />
          <Skeleton className="ml-auto h-3 w-8" />
          <Skeleton className="ml-auto h-2.5 w-6" />
        </div>
      ))}
    </div>
  );
}

/** The plain lists in a panel (recent clicks, team activity): h-9 rows, a
 * name on the left and a quiet figure on the right. */
function LineListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col">
      {barWidths.slice(0, rows).map((w) => (
        <div key={w} className="flex h-9 items-center justify-between gap-3">
          <Skeleton className="h-3" style={{ width: `${Math.max(30, w * 0.8)}%` }} />
          <Skeleton className="h-2.5 w-14 shrink-0" />
        </div>
      ))}
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
 * /dashboard once there is a link: "Dashboard" with New link on the right,
 * then, `gap-6` apart, the three-figure strip over the week's chart (180)
 * and the two panels side by side: top links as a bar list, recent clicks
 * as h-9 rows.
 *
 * An account on its very first run gets a header and one field instead, so
 * it watches this shape go once. Every visit after that lands on it.
 */
export function DashboardSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton action={<NewLinkButtonSkeleton />} />
      <div className="flex flex-col gap-6">
        <StatsChartSkeleton figures={3} chartHeight={180} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PanelSkeleton tabs={["w-16", "w-28"]} end>
            <BarListSkeleton rows={6} />
          </PanelSkeleton>
          <PanelSkeleton tabs={["w-24", "w-24"]}>
            <LineListSkeleton rows={6} />
          </PanelSkeleton>
        </div>
      </div>
    </SkeletonStatus>
  );
}

/**
 * /analytics: the title over "All links · last N days", the range control
 * (a 32px segmented track) and Export CSV (a `sm` button) on the right; then
 * the four-figure strip over the chart (180), the 2x2 grid of panels (links,
 * sources, places, devices) and the by-hour panel (260) under it.
 *
 * The by-hour panel is left out of the 24-hour view and before the first
 * click; it is last, so leaving it drawn moves nothing above it.
 */
export function AnalyticsSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton
        sub
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-8 w-44 rounded-[9px]" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        <StatsChartSkeleton figures={4} chartHeight={180} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PanelSkeleton tabs={["w-16", "w-16", "w-8"]}>
            <BarListSkeleton rows={6} />
          </PanelSkeleton>
          <PanelSkeleton tabs={["w-16"]}>
            <BarListSkeleton rows={6} />
          </PanelSkeleton>
          <PanelSkeleton tabs={["w-16", "w-6"]}>
            <BarListSkeleton rows={6} />
          </PanelSkeleton>
          <PanelSkeleton tabs={["w-12"]}>
            <BarListSkeleton rows={3} />
          </PanelSkeleton>
        </div>
        <PanelSkeleton tabs={["w-14", "w-20"]}>
          <Skeleton className="h-[260px] w-full" />
        </PanelSkeleton>
      </div>
    </SkeletonStatus>
  );
}

/** admin/layout.tsx's own tab widths, measured (icon + label + padding):
 * Usage, Links, Organizations, Users, Audit log. Only shown while
 * AdminLayout's chunk is still loading and its real nav hasn't mounted yet
 * (AdminPlatformSkeleton below); AdminLayout's own inner Suspense falls back
 * to the content-only skeletons beneath, since by then the real nav is
 * already on screen. */
const adminTabWidths = ["w-10", "w-8", "w-[5.5rem]", "w-9", "w-14"];

function AdminTabBarSkeleton() {
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 pb-px">
      {adminTabWidths.map((w) => (
        <div key={w} className="flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2">
          <Skeleton className="h-[15px] w-[15px] shrink-0 rounded-sm" />
          <span className="flex h-5 items-center">
            <Skeleton className={cn("h-3", w)} />
          </span>
        </div>
      ))}
    </nav>
  );
}

/** The whole /admin section before AdminLayout's own lazy chunk has
 * resolved: its nav doesn't exist yet, so without this the tab bar popped
 * in above the header once it did, shoving everything below it down. */
export function AdminPlatformSkeleton() {
  const location = useLocation();
  const Content = skeletonFor(location.pathname, location.searchStr);
  return (
    <div className="flex flex-col gap-5">
      <AdminTabBarSkeleton />
      <Content />
    </div>
  );
}

/** /admin: header, 6 stat cards, two charts, two ranked lists. */
export function AdminUsageSkeleton() {
  return (
    <SkeletonStatus testId="admin-usage-skeleton">
      <HeaderSkeleton sub />
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
function AdminTableSkeleton() {
  return (
    <div data-testid="admin-table-skeleton">
      <HeaderSkeleton sub />
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
      <HeaderSkeleton sub />
      <TableSkeleton rows={5} />
    </div>
  );
}

/**
 * SettingsGroup: an optional small heading (a text-sm line, with its hint
 * beside it) `gap-2` above one card whose rows are split by inset hairlines.
 * `title` and `hint` are bar widths.
 */
function GroupSkeleton({
  title,
  hint,
  danger,
  children,
}: {
  title?: string;
  hint?: string;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      {title && (
        <div className="flex h-5 items-center gap-3">
          <Skeleton className={cn("h-3", title)} />
          {hint && <Skeleton className={cn("h-2.5", hint)} />}
        </div>
      )}
      <div
        className={cn(
          "rounded-xl bg-surface [&>*+*]:shadow-[inset_0_1px_0_var(--border)]",
          danger
            ? "shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_35%,transparent)]"
            : "smooth-shadow-ring-xs",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** SettingsRow: label (and its one-line hint) on the left, the control on the
 * right, `min-h-14`; on a phone the control drops under the label. */
function RowSkeleton({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5">
      <div className="min-w-0 sm:w-64">
        <span className="flex h-5 items-center">
          <Skeleton className={cn("h-3", label)} />
        </span>
        {hint && (
          <span className="mt-0.5 flex h-4 items-center">
            <Skeleton className={cn("h-2.5 max-w-full", hint)} />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5 max-sm:w-full max-sm:justify-start">
        {children}
      </div>
    </div>
  );
}

/** The settings column Settings, Organization, Billing and Domains share. */
function SettingsColumn({ children }: { children: ReactNode }) {
  return <div className="flex max-w-[760px] flex-col gap-8">{children}</div>;
}

/** The domain list while it loads: the same rows domains.tsx draws for its
 * own loading state (min-h-16, hostname over its detail line, status pill). */
const domainRows = [40, 55];

export function DomainsSkeleton() {
  return (
    <SkeletonStatus>
      <GroupSkeleton>
        {domainRows.map((w) => (
          <div key={w} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
          </div>
        ))}
      </GroupSkeleton>
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

/** /invite: the two lines of `text-sm` invite text, then the action button
 * `mt-5` below, inside the existing centered card. */
export function InviteSkeleton() {
  return (
    <SkeletonStatus className="flex flex-col items-center">
      <span className="flex h-5 items-center">
        <Skeleton className="h-3 w-64 max-w-full" />
      </span>
      <span className="flex h-5 items-center">
        <Skeleton className="h-3 w-40" />
      </span>
      <Skeleton className="mt-5 h-9 w-32" />
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
function SidebarSkeleton({ collapsed }: { collapsed: boolean }) {
  const hide = collapsed && "opacity-0";
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* the mark, then search and fold (shell.tsx, SidebarTop) */}
      <div className="hidden h-14 items-center px-3 md:flex">
        <span className="grid size-9 place-items-center">
          <LogoMark className="h-[18px]" />
        </span>
      </div>

      {/* org switcher: the initial and name are data */}
      <div className="px-3 py-2">
        <div className="flex h-10 w-full min-w-9 items-center gap-2.5 px-1.5">
          <Skeleton className="size-6 shrink-0 rounded-md" />
          <span className={cn("flex h-5 min-w-0 flex-1 items-center", hide)}>
            <Skeleton className="h-3.5 w-28" />
          </span>
          <ChevronsUpDown size={14} className={cn("shrink-0 text-muted", hide)} />
        </div>
      </div>

      {/* nav: real labels and icons, inert until the shell mounts */}
      <nav className="flex flex-col gap-0.5 px-3 py-2">
        {appNavItems.map(({ icon: Icon, label }) => (
          <span
            key={label}
            className="flex h-9 min-w-9 items-center gap-2.5 rounded-lg px-2.5 text-sm whitespace-nowrap text-muted [&_svg]:shrink-0"
          >
            <Icon size={15} /> <span className={cn(hide)}>{label}</span>
          </span>
        ))}
      </nav>

      {/* account: the avatar and name are data */}
      <div className="mt-auto px-3 py-3">
        <div className="flex min-w-9 items-center gap-2.5 px-1 py-1.5">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <span className={cn("flex h-5 min-w-0 flex-1 items-center", hide)}>
            <Skeleton className="h-3 w-2/3" />
          </span>
        </div>
      </div>
    </div>
  );
}

/** First paint of the authenticated app: real sidebar chrome + skeleton
 * content. Layout classes mirror AppShell so the swap doesn't shift,
 * folded sidebar included. */
export function AppShellSkeleton() {
  const collapsed = useSidebarCollapsed();
  const layout = shellLayout(collapsed);
  return (
    <div className="flex min-h-dvh" data-testid="app-shell-skeleton">
      <aside className={layout.aside}>
        <SidebarSkeleton collapsed={collapsed} />
      </aside>

      {/* mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
        <span className="p-1.5 text-muted">
          <MenuIcon size={18} />
        </span>
        <Logo className="text-sm" />
      </div>

      <main className={layout.main}>
        <div data-app-sheet className={layout.scroller}>
          <div className="mx-auto w-full max-w-5xl flex-1">
            {/* whichever page was asked for, not always the dashboard */}
            <RouteSkeleton />
          </div>
        </div>
      </main>
    </div>
  );
}

/** One line of a two-line table cell: bold text-sm (20px) over mono text-xs
 * (16px), `gap-0.5`, which is what makes the rows 59px. */
function TwoLineCellSkeleton({ first, second }: { first: string; second: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex h-5 items-center">
        <Skeleton className={cn("h-3.5", first)} />
      </span>
      <span className="flex h-4 items-center">
        <Skeleton className={cn("h-2.5", second)} />
      </span>
    </div>
  );
}

/** Table's frame and a header row (Th: `py-2.5` around a text-xs line, then
 * its 1px rule). `children` are the body rows. */
function TableFrameSkeleton({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl bg-surface smooth-shadow-ring-xs">
      <div className="flex border-b border-border">{head}</div>
      {children}
    </div>
  );
}

/** A Th's text-xs label as a bar, in the cell's own padding and width. */
function HeadCellSkeleton({ className, bar }: { className?: string; bar?: string }) {
  return (
    <div className={cn("flex h-4 box-content items-center px-4 py-2.5", className)}>
      {bar && <Skeleton className={cn("h-2.5", bar)} />}
    </div>
  );
}

const linkRowWidths = [
  ["w-2/5", "w-3/5"],
  ["w-1/2", "w-2/5"],
  ["w-1/3", "w-1/2"],
  ["w-3/5", "w-1/3"],
];

/**
 * /links: "Links" over the count, Import and Export (quiet, `sm` and up;
 * a 36px menu button on a phone) beside New link; the search field
 * (`mb-4`); then the table in two-line rows. The domain filter and the pager
 * only appear for some organizations, so they stay out.
 */
export function LinksSkeleton() {
  return (
    <SkeletonStatus testId="links-page-skeleton">
      <HeaderSkeleton
        sub
        action={
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1 sm:flex">
              <ButtonSkeleton className="w-[6.25rem]" />
              <ButtonSkeleton className="w-[6.25rem]" />
            </div>
            <ButtonSkeleton className="w-9 sm:hidden" />
            <NewLinkButtonSkeleton />
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Skeleton className="h-9 w-full max-w-64 rounded-lg" />
      </div>
      <TableFrameSkeleton
        head={
          <>
            <HeadCellSkeleton className="min-w-0 flex-1" bar="w-10" />
            <HeadCellSkeleton className="hidden w-[34%] lg:flex" bar="w-20" />
            <HeadCellSkeleton className="w-20 shrink-0 justify-end" bar="w-12" />
            <HeadCellSkeleton className="hidden w-28 shrink-0 sm:flex" bar="w-14" />
            <HeadCellSkeleton className="w-12 shrink-0" />
          </>
        }
      >
        {Array.from({ length: 12 }, (_, i) => {
          const [first, second] = linkRowWidths[i % linkRowWidths.length];
          return (
            <div key={i} className="flex items-center border-b border-border/50">
              <div className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5">
                <span className="w-6 shrink-0" />
                <TwoLineCellSkeleton first={first} second={second} />
              </div>
              <div className="hidden w-[34%] px-4 py-2.5 lg:flex">
                <TwoLineCellSkeleton first="w-1/2" second="w-3/4" />
              </div>
              <div className="flex w-20 shrink-0 justify-end px-4">
                <Skeleton className="h-3 w-8" />
              </div>
              <div className="hidden w-28 shrink-0 px-4 sm:flex">
                <Skeleton className="h-2.5 w-14" />
              </div>
              <div className="w-12 shrink-0" />
            </div>
          );
        })}
      </TableFrameSkeleton>
    </SkeletonStatus>
  );
}

/**
 * /members: "Members" over the seat count with Invite people on the right,
 * then the people table in two-line rows (name over email). The seats-full
 * notice and the pending invites only exist for some organizations.
 */
export function MembersSkeleton() {
  return (
    <SkeletonStatus testId="members-page-skeleton">
      <HeaderSkeleton sub action={<ButtonSkeleton className="w-40" />} />
      <TableFrameSkeleton
        head={
          <>
            <HeadCellSkeleton className="min-w-0 flex-1" bar="w-12" />
            <HeadCellSkeleton className="w-28 shrink-0" bar="w-10" />
            <HeadCellSkeleton className="hidden w-32 shrink-0 sm:flex" bar="w-12" />
            <HeadCellSkeleton className="w-14 shrink-0" />
          </>
        }
      >
        {linkRowWidths.map(([first, second]) => (
          <div key={first} className="flex items-center border-b border-border/50">
            <div className="flex min-w-0 flex-1 px-4 py-2.5">
              <TwoLineCellSkeleton first={first} second={second} />
            </div>
            <div className="w-28 shrink-0 px-4">
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="hidden w-32 shrink-0 px-4 sm:flex">
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="w-14 shrink-0" />
          </div>
        ))}
      </TableFrameSkeleton>
    </SkeletonStatus>
  );
}

/**
 * /domains, for somebody who can add one: "Domains" with Add domain on the
 * right, then the domain rows in the settings column.
 */
export function DomainsPageSkeleton() {
  return (
    <div data-testid="domains-page-skeleton">
      <HeaderSkeleton action={<ButtonSkeleton className="w-[8.5rem]" />} />
      <SettingsColumn>
        <DomainsSkeleton />
      </SettingsColumn>
    </div>
  );
}

const planFeatureWidths = ["w-24", "w-28", "w-32", "w-28", "w-36", "w-44", "w-32"];

/** PlanCard: name, price, the feature list (as long as Pro's, since the grid
 * makes every card as tall as the longest) and the button at the foot. */
function PlanCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface p-4 smooth-shadow-ring-xs">
      <span className="flex h-6 items-center">
        <Skeleton className="h-3.5 w-14" />
      </span>
      <span className="flex h-7 items-center">
        <Skeleton className="h-5 w-24" />
      </span>
      <div className="flex flex-col gap-1.5">
        {planFeatureWidths.map((w, i) => (
          <span key={i} className="flex h-5 items-center">
            <Skeleton className={cn("h-3 max-w-full", w)} />
          </span>
        ))}
      </div>
      <div className="mt-auto pt-1">
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    </div>
  );
}

/**
 * /billing on the free plan, which is most people who open it: the title
 * over its one line, the Usage group (the 44px rows billing.tsx draws while
 * the figures load, then Organizations you own), then Plans with the billing
 * cycle switch and the three plan cards. A paid plan opens on its own plan
 * row instead, a shape nobody can know before the plan arrives.
 */
export function BillingSkeleton({ plan }: { plan?: OrgPlan } = {}) {
  // Paid: the plan row, usage and payment. Free (or not yet known): usage
  // above the three plan cards.
  if (plan && plan !== "free")
    return (
      <SkeletonStatus testId="billing-page-skeleton">
        <HeaderSkeleton />
        <SettingsColumn>
          <GroupSkeleton>
            <div className="flex min-h-[4.5rem] items-center justify-between gap-6 px-4 py-4">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-52" />
              </div>
              <Skeleton className="h-8 w-28 rounded-lg" />
            </div>
          </GroupSkeleton>
          <GroupSkeleton title="w-12" hint="w-24">
            {[24, 28, 20, 40].map((w) => (
              <div key={w} className="flex h-11 items-center px-4">
                <Skeleton className="h-3.5" style={{ width: `${w * 0.25}rem` }} />
              </div>
            ))}
          </GroupSkeleton>
          <GroupSkeleton title="w-16">
            <div className="flex min-h-14 items-center justify-between px-4">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-8 w-36 rounded-lg" />
            </div>
          </GroupSkeleton>
        </SettingsColumn>
      </SkeletonStatus>
    );
  return (
    <SkeletonStatus testId="billing-page-skeleton">
      <HeaderSkeleton sub />
      <SettingsColumn>
        <GroupSkeleton title="w-12" hint="w-24">
          {[24, 28, 20, 40, 44].map((w) => (
            <div key={w} className="flex h-11 items-center px-4">
              <Skeleton className="h-3.5" style={{ width: `${w * 0.25}rem` }} />
            </div>
          ))}
        </GroupSkeleton>
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex h-5 items-center gap-3">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-2.5 w-48" />
            </div>
            <Skeleton className="h-8 w-52 rounded-[9px]" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <PlanCardSkeleton />
            <PlanCardSkeleton />
            <PlanCardSkeleton />
          </div>
        </section>
      </SettingsColumn>
    </SkeletonStatus>
  );
}

/**
 * /settings: the Account group (picture, name, email, dark mode), Save on
 * the right under it (`gap-3`), and the delete-account group outlined in
 * the danger colour, `gap-8` apart in the settings column.
 */
export function SettingsSkeleton() {
  return (
    <SkeletonStatus testId="settings-page-skeleton">
      <HeaderSkeleton />
      <SettingsColumn>
        <div className="flex flex-col gap-3">
          <GroupSkeleton title="w-16">
            <RowSkeleton label="w-14" hint="w-40">
              <Skeleton className="size-10 rounded-full" />
            </RowSkeleton>
            <RowSkeleton label="w-10">
              <Skeleton className="h-9 w-60 rounded-lg max-sm:w-full" />
            </RowSkeleton>
            <RowSkeleton label="w-12">
              <Skeleton className="h-2.5 w-48" />
            </RowSkeleton>
            <RowSkeleton label="w-20" hint="w-44">
              <Skeleton className="h-5 w-9 rounded-full" />
            </RowSkeleton>
          </GroupSkeleton>
          <div className="flex justify-end">
            <ButtonSkeleton className="w-16" />
          </div>
        </div>
        <GroupSkeleton danger>
          <RowSkeleton label="w-28" hint="w-56">
            <ButtonSkeleton className="w-36" />
          </RowSkeleton>
        </GroupSkeleton>
      </SettingsColumn>
    </SkeletonStatus>
  );
}

/** The "API keys" / "MCP" tab bar on /api-keys, matching ApiTabBar's own box
 * model button for button: each tab is `px-3 py-2 text-sm` with its own
 * `border-b-2`, inside a nav that has its own `border-b` beneath them. A
 * bare pair of bars under one `pb-2` line, what this used to be, sat 14px
 * shorter than the real thing, so the whole page below it jumped up once
 * the real tabs landed. Shared by both tab skeletons below so switching
 * tabs (or reloading on either one) never moves the bar itself. */
const apiTabLabelWidths = ["w-14", "w-8"];

function ApiTabBarSkeleton() {
  return (
    <div className="mb-6 flex gap-1 border-b border-border">
      {apiTabLabelWidths.map((w) => (
        <div key={w} className="border-b-2 border-transparent px-3 py-2">
          <span className="flex h-5 items-center">
            <Skeleton className={cn("h-3", w)} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** /api-keys?tab=keys (the default): the name field beside a fixed-width
 * Create button, then the keys table. */
export function ApiKeysSkeleton() {
  return (
    <SkeletonStatus testId="api-keys-page-skeleton">
      <HeaderSkeleton sub />
      <ApiTabBarSkeleton />
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Skeleton className="h-9 min-w-0 flex-1" />
          <Skeleton className="h-9 w-28 shrink-0" />
        </div>
        <TableSkeleton rows={3} />
      </div>
    </SkeletonStatus>
  );
}

/** /api-keys?tab=mcp: same header and tab bar. A table-shaped guess below
 * them either way — whether this resolves to the connect guide (a first
 * visit) or the connected-apps table (a returning one) isn't known until
 * the query answers, and this is a brief, transient state either way. */
function McpTabSkeleton() {
  return (
    <SkeletonStatus testId="mcp-tab-skeleton">
      <HeaderSkeleton sub />
      <ApiTabBarSkeleton />
      <TableSkeleton rows={3} />
    </SkeletonStatus>
  );
}

/**
 * /organization, as its owner sees it: the name row (field and Save) and the
 * ID row, the QR code defaults group, and the delete group outlined in the
 * danger colour. The QR group's body is one line here (the free plan's
 * upgrade prompt); a paid plan's editor is taller, and it is the second
 * last thing on the page.
 */
export function OrganizationSkeleton() {
  return (
    <SkeletonStatus testId="organization-page-skeleton">
      <HeaderSkeleton />
      <SettingsColumn>
        <GroupSkeleton>
          <RowSkeleton label="w-10">
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Skeleton className="h-9 min-w-0 flex-1 rounded-lg sm:w-60 sm:flex-none" />
              <ButtonSkeleton className="w-16" />
            </div>
          </RowSkeleton>
          <RowSkeleton label="w-32" hint="w-20">
            <Skeleton className="h-2.5 w-56" />
            <Skeleton className="size-7 rounded-md" />
          </RowSkeleton>
        </GroupSkeleton>
        <GroupSkeleton title="w-32" hint="w-72">
          <div className="p-4">
            <span className="flex h-5 items-center">
              <Skeleton className="h-3 w-full max-w-md" />
            </span>
          </div>
        </GroupSkeleton>
        <GroupSkeleton danger>
          <RowSkeleton label="w-36" hint="w-64">
            <ButtonSkeleton className="w-48" />
          </RowSkeleton>
        </GroupSkeleton>
      </SettingsColumn>
    </SkeletonStatus>
  );
}

/** /links/:slug: header, the clicks chart, and the addresses table. */
export function LinkDetailSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton sub action={<Skeleton className="h-8 w-28 shrink-0 rounded-lg" />} />
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
  "/organization": OrganizationSkeleton,
  "/admin": AdminUsageSkeleton,
} satisfies Record<string, () => ReactElement>;

/** /api-keys carries which of its two tabs is open in ?tab=, not in the
 * path, so PAGE_SKELETONS can't tell them apart on its own. */
function apiKeysSkeletonFor(search: string): () => ReactElement {
  return new URLSearchParams(search).get("tab") === "mcp" ? McpTabSkeleton : ApiKeysSkeleton;
}

function skeletonFor(pathname: string, search: string): () => ReactElement {
  // The two routes with something after the prefix: an admin tab is a table,
  // and a single link is its own page.
  if (pathname.startsWith("/admin/")) return AdminTableSkeleton;
  if (pathname.startsWith("/links/")) return LinkDetailSkeleton;
  if (pathname === "/api-keys") return apiKeysSkeletonFor(search);
  return lookup(PAGE_SKELETONS, pathname) ?? PageSkeleton;
}

/** The same thing for callers that are inside the router and have no path in
 * hand, which is all of them. */
export function RouteSkeleton() {
  const location = useLocation();
  const Page = skeletonFor(location.pathname, location.searchStr);
  return <Page />;
}
