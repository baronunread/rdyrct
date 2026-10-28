import type { OrgPlan } from "@/shared/types";
import type { ReactElement, ReactNode } from "react";
import { lookup } from "@/shared/lookup";
import { useLocation } from "@tanstack/react-router";
import { ChevronsUpDown, MenuIcon, Search } from "@/app/ui/icons";
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
 * `mt-1` sub at text-sm (20px), with `mb-6` under it. Settings, Organization
 * and the dashboard have no sub, so it is off unless asked for. The bars are
 * shorter than the text they replace, so each sits in a box of the line's
 * height rather than setting it.
 *
 * `action` is whatever the page hangs on the right, drawn at the size of the
 * real controls (`ButtonSkeleton` for a 36px button).
 */
function HeaderSkeleton({
  sub = false,
  subWidth = "w-32 sm:w-64",
  action,
}: {
  sub?: boolean;
  /** The sub bar's width. Set it where the page's own line is long enough
   * to push the action under the title on a phone. */
  subWidth?: string;
  action?: ReactNode;
} = {}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <span className="flex h-7 items-center">
          <Skeleton className="h-5 w-40" />
        </span>
        {sub && (
          <span className="mt-1 flex h-5 items-center">
            {/* narrower on a phone, so the title block leaves the action
                room beside it, as the real one does */}
            <Skeleton className={cn("h-3", subWidth)} />
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

/** A `sm` Button (h-8). */
function SmallButtonSkeleton({ className }: { className: string }) {
  return <Skeleton className={cn("h-8 shrink-0 rounded-lg", className)} />;
}

/** NewLinkButton: icon, "New link" and its `C` key, which hides on a phone. */
function NewLinkButtonSkeleton() {
  return <ButtonSkeleton className="w-[6.625rem] sm:w-[8.5rem]" />;
}

/**
 * Segmented: a 9px track, 2px of padding, segments 28px tall (36 on a
 * phone, where they also gain 2px a side). `labels` are the label widths in
 * px, so each segment is as wide as the real one.
 */
function SegmentedSkeleton({ labels }: { labels: number[] }) {
  return (
    <div className="flex w-fit shrink-0 animate-pulse gap-0.5 rounded-[9px] bg-surface-2 p-0.5">
      {/* Index keys: two labels can share a width. The list never reorders. */}
      {labels.map((w, i) => (
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- as above.
        <span
          key={i}
          className="box-content h-7 px-2.5 max-sm:h-9 max-sm:px-3"
          style={{ width: w }}
        />
      ))}
    </div>
  );
}

/** The range presets' labels (24h, 7d, 30d, 365d) as RangeControl sets them. */
const RANGE_LABEL = { "24h": 21, "7d": 14, "30d": 21, "365d": 27 } as const;

/**
 * StatsChart: the strip of figures over the chart in one card. Each figure is
 * a text-xs label over a text-xl leading-tight value (25px) in `px-2.5 py-2`,
 * the first one shaded; the chart sits in `px-4 pt-1 pb-3` at its own height.
 * On a phone a figure takes at least 40%, so three or four make two rows.
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
      <TabsSkeleton tabs={tabs} className="mb-3">
        {end && (
          <span className="ml-auto flex h-4 box-content items-center pb-2.5">
            <Skeleton className="h-2.5 w-14" />
          </span>
        )}
      </TabsSkeleton>
      {children}
    </div>
  );
}

/** A row of underline tabs over a hairline drawn as an inset shadow: each a
 * 20px text-sm label with `pb-2.5` under it. */
function TabsSkeleton({
  tabs,
  className,
  children,
}: {
  tabs: string[];
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-4 shadow-[inset_0_-1px_0_var(--border)]", className)}>
      {/* Index keys: two tabs can share a width. The list never reorders. */}
      {tabs.map((w, i) => (
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key -- as above.
        <span key={i} className="flex h-5 box-content items-center pb-2.5">
          <Skeleton className={cn("h-3", w)} />
        </span>
      ))}
      {children}
    </div>
  );
}

const barWidths = [92, 71, 58, 44, 33, 24, 17];

/** BarList with column headings: a 20px heading row, then 30px bars
 * `gap-y-0.5` apart, the count and share in their own columns. `more` is
 * the "Show all" button under a list cut at seven (28px, `mt-2 -mb-1`). */
function BarListSkeleton({ rows, more }: { rows: number; more?: boolean }) {
  return (
    <div className="flex flex-col">
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
      {more && (
        <span className="mx-auto mt-2 -mb-1 flex h-7 items-center px-2">
          <Skeleton className="h-2.5 w-16" />
        </span>
      )}
    </div>
  );
}

/** The plain lists in a panel (recent clicks, team activity): h-8 rows split
 * by hairlines, a name on the left and a quiet figure on the right. */
function LineListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex h-8 items-center justify-between gap-3 [&+&]:shadow-[inset_0_1px_0_var(--border)]"
        >
          <Skeleton
            className="h-3"
            style={{ width: `${Math.max(30, barWidths[i % barWidths.length] * 0.8)}%` }}
          />
          <Skeleton className="h-2.5 w-14 shrink-0" />
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

/**
 * /dashboard once there is a link: "Dashboard" with the range (three
 * segments) and New link on the right, New link first on a phone; then,
 * `gap-6` apart, the four-figure strip over the chart (180) and the two
 * panels side by side: top links as a bar list, recent clicks as eight h-8
 * rows.
 *
 * An account on its very first run gets a header and one field instead, so
 * it watches this shape go once. Every visit after that lands on it.
 */
export function DashboardSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex sm:order-last">
              <NewLinkButtonSkeleton />
            </div>
            <SegmentedSkeleton
              labels={[RANGE_LABEL["24h"], RANGE_LABEL["7d"], RANGE_LABEL["30d"]]}
            />
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        <StatsChartSkeleton figures={4} chartHeight={180} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PanelSkeleton tabs={["w-16", "w-28"]} end>
            <BarListSkeleton rows={6} />
          </PanelSkeleton>
          <PanelSkeleton tabs={["w-24", "w-24"]}>
            <LineListSkeleton rows={8} />
          </PanelSkeleton>
        </div>
      </div>
    </SkeletonStatus>
  );
}

/**
 * /analytics: the title over "All links · last N days", the range (four
 * segments) and Export CSV (a `sm` button) on the right; then the figure
 * strip over the chart (180), the 2x2 grid of panels (links, sources and
 * places cut at seven rows with "Show all" under them, and devices) and the
 * by-hour panel (260) under it.
 *
 * The strip has three figures until the API sends clicks per link, and
 * each list is only cut when it has more than seven rows; a figure more or
 * fewer only changes their widths. The by-hour panel is left out of the
 * 24-hour view and before the first click; it is last, so leaving it drawn
 * moves nothing above it.
 */
export function AnalyticsSkeleton() {
  return (
    <SkeletonStatus>
      <HeaderSkeleton
        sub
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedSkeleton
              labels={[
                RANGE_LABEL["24h"],
                RANGE_LABEL["7d"],
                RANGE_LABEL["30d"],
                RANGE_LABEL["365d"],
              ]}
            />
            <SmallButtonSkeleton className="w-[6.5rem]" />
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        <StatsChartSkeleton figures={3} chartHeight={180} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PanelSkeleton tabs={["w-16", "w-16", "w-8"]}>
            <BarListSkeleton rows={7} more />
          </PanelSkeleton>
          <PanelSkeleton tabs={["w-16"]}>
            <BarListSkeleton rows={7} more />
          </PanelSkeleton>
          <PanelSkeleton tabs={["w-16", "w-8"]}>
            <BarListSkeleton rows={7} more />
          </PanelSkeleton>
          <PanelSkeleton tabs={["w-14"]}>
            <BarListSkeleton rows={4} />
          </PanelSkeleton>
        </div>
        <PanelSkeleton tabs={["w-14", "w-20"]}>
          <Skeleton className="h-[260px] w-full" />
        </PanelSkeleton>
      </div>
    </SkeletonStatus>
  );
}

/** admin/layout.tsx's tab label widths, measured: Usage, Users,
 * Organizations, Links, Audit log. */
const adminTabWidths = ["w-10", "w-9", "w-[5.5rem]", "w-8", "w-14"];

/** The usage range (7d, 30d, 90d) in the Platform header. */
const adminRangeLabels = [14, 21, 21];

/**
 * The whole /admin section before AdminLayout has rendered (its chunk is
 * loading, or the guard is waiting on the user): "Platform" over its line,
 * the range on Usage, the underline tabs, then the open tab's content. The
 * title is a bar, not the word: whoever is waiting may not be an admin, and
 * the section answers everybody else with a 404.
 */
export function AdminPlatformSkeleton() {
  const location = useLocation();
  const onUsage = location.pathname === "/admin" || location.pathname === "/admin/";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="flex h-7 items-center">
              <Skeleton className="h-5 w-28" />
            </span>
            <span className="mt-1 flex h-5 items-center">
              <Skeleton className="h-3 w-64 max-w-full" />
            </span>
          </div>
          {onUsage && <SegmentedSkeleton labels={adminRangeLabels} />}
        </div>
        <div className="-mx-1 flex gap-5 overflow-x-hidden px-1 shadow-[inset_0_-1px_0_var(--border)]">
          {adminTabWidths.map((w) => (
            <span key={w} className="flex h-5 box-content shrink-0 items-center pb-2.5">
              <Skeleton className={cn("h-3", w)} />
            </span>
          ))}
        </div>
      </div>
      <AdminSectionSkeleton />
    </div>
  );
}

/** The open admin tab's content alone, for AdminLayout's own Suspense: by
 * then the real title and tabs are on screen above it. */
export function AdminSectionSkeleton() {
  const location = useLocation();
  const onUsage = location.pathname === "/admin" || location.pathname === "/admin/";
  return onUsage ? <AdminUsageSkeleton /> : <AdminTableSkeleton />;
}

/** The usage chart's height (usage.tsx). */
const ADMIN_CHART_HEIGHT = 200;

/** /admin: mirrors the page below the layout's title and tabs: the figure
 * strip over the chart, then two cards side by side. Here rather than in
 * usage.tsx so the section's frame can draw it before that chunk loads. */
export function AdminUsageSkeleton() {
  return (
    <SkeletonStatus testId="admin-usage-skeleton" className="flex flex-col gap-6">
      <div className="rounded-xl bg-surface smooth-shadow-ring-xs">
        <div className="grid grid-cols-2 gap-1 p-1.5 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 px-2.5 py-2">
              <Skeleton className="h-2.5 w-14" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
        <div className="px-4 pt-1 pb-3">
          <Skeleton className="mb-2 h-2.5 w-28" />
          <Skeleton className="w-full" style={{ height: ADMIN_CHART_HEIGHT }} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-xl bg-surface p-4 smooth-shadow-ring-xs"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-[30px] w-full" />
            <Skeleton className="h-[30px] w-3/4" />
            <Skeleton className="h-[30px] w-1/2" />
          </div>
        ))}
      </div>
    </SkeletonStatus>
  );
}

/** /admin/users, /orgs and /links: the filter pills and the search box in
 * one row (`mb-4`; on a phone the search goes on top), then the table. */
function AdminTableSkeleton() {
  return (
    <div data-testid="admin-table-skeleton">
      <div className="mb-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-0.5">
          {["w-14", "w-20", "w-16"].map((w) => (
            <Skeleton key={w} className={cn("h-8 rounded-lg", w)} />
          ))}
        </div>
        <Skeleton className="h-9 w-full rounded-lg sm:max-w-xs" />
      </div>
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
          {hint && <Skeleton className={cn("h-2.5 max-w-[60%]", hint)} />}
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
  children?: ReactNode;
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
      {children && (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2.5 max-sm:w-full max-sm:justify-start">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The centred column Settings, Organization, Billing and Domains share, with
 * the page header inside it: the header has to sit where the page's own
 * does, or the title jumps sideways when the page arrives.
 */
function SettingsPageSkeleton({
  header,
  testId,
  children,
}: {
  header: ReactNode;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <SkeletonStatus testId={testId} className="mx-auto w-full max-w-[760px]">
      {header}
      {children && <div className="flex max-w-[760px] flex-col gap-8">{children}</div>}
    </SkeletonStatus>
  );
}

/** The domain list while it loads: the same rows domains.tsx draws (min-h-
 * [60px], `py-3`: the hostname over its detail line, then the status and the
 * row's menu on the right). */
const domainRows = [40, 55];

export function DomainsSkeleton() {
  return (
    <SkeletonStatus>
      <GroupSkeleton>
        {domainRows.map((w) => (
          <div key={w} className="flex min-h-[60px] items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <span className="flex h-5 items-center">
                <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
              </span>
              <span className="mt-0.5 flex h-4 items-center">
                <Skeleton className="h-2.5 w-1/3" />
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-3 pt-0.5">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
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

      {/* phone top bar: the menu button, the logo, the search button */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-[52px] items-center gap-1.5 bg-bg/90 px-3 backdrop-blur md:hidden">
        <span className="grid size-10 place-items-center text-text">
          <MenuIcon size={20} />
        </span>
        <span className="text-base">
          <Logo />
        </span>
        <span className="ml-auto grid size-10 place-items-center text-muted">
          <Search size={20} />
        </span>
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
 * (16px), `gap-0.5`. */
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
function TableFrameSkeleton({
  head,
  headClassName,
  children,
}: {
  head: ReactNode;
  headClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-surface smooth-shadow-ring-xs">
      <div className={cn("flex border-b border-border", headClassName)}>{head}</div>
      {children}
    </div>
  );
}

/** A Th's text-xs label as a bar, in the cell's own padding and width: 36px,
 * `py-2.5` around a 16px line. */
function HeadCellSkeleton({ className, bar }: { className?: string; bar?: string }) {
  return (
    <div className={cn("flex h-9 items-center px-4", className)}>
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
 * /links: "Links" over the count, Import and Export (quiet, `sm` and up; a
 * 40px menu button on a phone) beside New link; then, `gap-4` apart, the
 * toolbar row (44px from `sm`, the search on the right; on a phone the
 * search alone, full width and 44px tall) and the table: a checkbox column
 * (from `sm`), the link with its 28px thumbnail, the destination (30%, from
 * `lg`), clicks, created (from `sm`) and the actions, in 63px rows, with the
 * pager's 48px line under them. A phone has no table header.
 *
 * The filter chips and the domain filter are left out: the chips wait on
 * their counts and only fill space beside the search, and the domain filter
 * only exists for an organization with a custom domain.
 */
export function LinksSkeleton() {
  return (
    <SkeletonStatus testId="links-page-skeleton">
      <HeaderSkeleton
        sub
        action={
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1 sm:flex">
              <ButtonSkeleton className="w-[5.75rem]" />
              <ButtonSkeleton className="w-[5.75rem]" />
            </div>
            <ButtonSkeleton className="w-10 sm:hidden" />
            <NewLinkButtonSkeleton />
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        <div className="flex sm:min-h-11 sm:items-center sm:justify-end">
          <Skeleton className="h-11 w-full rounded-lg sm:h-9 sm:w-64" />
        </div>
        <TableFrameSkeleton
          headClassName="max-sm:hidden"
          head={
            <>
              <HeadCellSkeleton className="w-10 shrink-0 pr-0 pl-2" />
              <HeadCellSkeleton className="min-w-0 flex-1" bar="w-10" />
              <HeadCellSkeleton className="hidden w-[30%] shrink-0 lg:flex" bar="w-20" />
              <HeadCellSkeleton className="w-20 shrink-0 justify-end" bar="w-12" />
              <HeadCellSkeleton className="w-32 shrink-0" bar="w-14" />
              <HeadCellSkeleton className="w-20 shrink-0" />
            </>
          }
        >
          {Array.from({ length: 12 }, (_, i) => {
            const [first, second] = linkRowWidths[i % linkRowWidths.length];
            return (
              <div key={i} className="flex h-[63px] items-center border-b border-border/50">
                <div className="hidden w-10 shrink-0 pl-2 sm:block">
                  <Skeleton className="ml-3 size-4 rounded-[5px]" />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-3 px-4 max-sm:pl-3">
                  <Skeleton className="size-8 shrink-0 rounded-md sm:size-7" />
                  <TwoLineCellSkeleton first={first} second={second} />
                </div>
                <div className="hidden w-[30%] shrink-0 items-center gap-2.5 px-4 lg:flex">
                  <Skeleton className="size-5 shrink-0 rounded-md" />
                  <TwoLineCellSkeleton first="w-1/2" second="w-3/4" />
                </div>
                <div className="flex w-20 shrink-0 justify-end px-4 max-sm:w-16">
                  <Skeleton className="h-3.5 w-8" />
                </div>
                <div className="hidden w-32 shrink-0 px-4 sm:block">
                  <TwoLineCellSkeleton first="w-12" second="w-16" />
                </div>
                <div className="w-20 shrink-0 max-sm:w-11" />
              </div>
            );
          })}
          <div className="flex min-h-12 items-center px-4 py-2">
            <Skeleton className="h-2.5 w-20" />
          </div>
        </TableFrameSkeleton>
      </div>
    </SkeletonStatus>
  );
}

/**
 * /members: "Members" over the seat count with the Invite split button on
 * the right, then the people table (a 32px avatar before the name over the
 * email, the role, the join date and the row actions from `sm`) and the
 * line about roles under it. The seats-full notice, the pending invites and
 * the last-active column only exist for some organizations.
 */
export function MembersSkeleton() {
  return (
    <SkeletonStatus testId="members-page-skeleton" className="flex flex-col">
      <HeaderSkeleton sub action={<ButtonSkeleton className="w-[7.5rem]" />} />
      <TableFrameSkeleton
        head={
          <>
            <HeadCellSkeleton className="min-w-0 flex-1" bar="w-12" />
            <HeadCellSkeleton className="w-32 shrink-0 sm:w-36" bar="w-10" />
            <HeadCellSkeleton className="hidden w-36 shrink-0 sm:flex" bar="w-12" />
            <HeadCellSkeleton className="hidden w-24 shrink-0 sm:flex" />
          </>
        }
      >
        {linkRowWidths.map(([first, second]) => (
          <div key={first} className="flex h-[63px] items-center border-b border-border/50">
            <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <TwoLineCellSkeleton first={first} second={second} />
            </div>
            <div className="w-32 shrink-0 px-4 sm:w-36">
              <Skeleton className="ml-2.5 h-3 w-14" />
            </div>
            <div className="hidden w-36 shrink-0 px-4 sm:block">
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="hidden w-24 shrink-0 sm:block" />
          </div>
        ))}
      </TableFrameSkeleton>
      <div className="mt-3 flex flex-col">
        <span className="flex h-4 items-center">
          <Skeleton className="h-2.5 w-[36rem] max-w-full" />
        </span>
        <span className="flex h-4 items-center sm:hidden">
          <Skeleton className="h-2.5 w-1/2" />
        </span>
      </div>
    </SkeletonStatus>
  );
}

/**
 * /domains, for somebody who can add one: "Domains" over the count with Add
 * domain on the right, then the domain rows, all in the settings column.
 */
export function DomainsPageSkeleton() {
  // A plain box, not a status: the rows below announce the loading once.
  return (
    <div data-testid="domains-page-skeleton" className="mx-auto w-full max-w-[760px]">
      <HeaderSkeleton sub action={<ButtonSkeleton className="w-32" />} />
      <DomainsSkeleton />
    </div>
  );
}

/** Every other /domains reader (no access, or a free plan): the title alone,
 * where the page puts it. */
export function DomainsHeaderSkeleton() {
  return <SettingsPageSkeleton testId="domains-header-skeleton" header={<HeaderSkeleton />} />;
}

/**
 * UsageRow: the label, the meter and "n of m" in one row (`py-3`, 44px) from
 * `sm`; on a phone the meter drops under the label and figure, 58px.
 * `hint` is the clicks row, whose "· resets …" wraps its label on a phone.
 */
function MeterRowSkeleton({ label, hint }: { label: string; hint?: boolean }) {
  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 sm:grid-cols-[13rem_1fr_9rem]">
        <span className={cn("flex items-center", hint ? "h-10 sm:h-5" : "h-5")}>
          <Skeleton className={cn("h-3", label)} />
        </span>
        <Skeleton className="col-span-2 row-start-2 h-1.5 rounded-full sm:col-span-1 sm:row-start-auto" />
        <span className="flex h-5 items-center justify-end">
          <Skeleton className="h-3 w-16" />
        </span>
      </div>
    </div>
  );
}

/** Each plan's feature lines (Free, Hobby, Pro), one of which wraps to two
 * lines at three cards a row. Side by side the grid makes every card as tall
 * as Pro's; stacked on a phone each is its own height. */
const planFeatureLines = [
  [{ w: "w-24" }, { w: "w-28" }, { w: "w-32" }, { w: "w-28" }],
  [
    { w: "w-24" },
    { w: "w-28" },
    { w: "w-32" },
    { w: "w-28" },
    { w: "w-44", wraps: true },
    { w: "w-32" },
  ],
  [
    { w: "w-24" },
    { w: "w-28" },
    { w: "w-32" },
    { w: "w-28" },
    { w: "w-36" },
    { w: "w-44", wraps: true },
    { w: "w-32" },
  ],
];

/** PlanCard: name, price, the feature list and the button at the foot. */
function PlanCardSkeleton({ lines }: { lines: { w: string; wraps?: boolean }[] }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface p-4 smooth-shadow-ring-xs">
      <span className="flex h-6 items-center">
        <Skeleton className="h-3.5 w-14" />
      </span>
      <span className="flex h-7 items-center">
        <Skeleton className="h-5 w-24" />
      </span>
      <div className="flex flex-col gap-1.5">
        {lines.map(({ w, wraps }) => (
          <span
            key={w}
            className={cn("flex flex-col justify-center", wraps ? "h-5 sm:h-10" : "h-5")}
          >
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
 * /billing. Free (or not yet known), which is most people who open it: the
 * title over its one line, the Usage group (links, members, clicks counted
 * and organizations you own), then Plans with the billing cycle switch and
 * the three plan cards. Paid: one card with the plan row (name and renewal,
 * Change plan and Cancel) over its five meters, then Payment and Invoices,
 * a row each.
 */
export function BillingSkeleton({ plan }: { plan?: OrgPlan } = {}) {
  if (plan && plan !== "free")
    return (
      <SettingsPageSkeleton testId="billing-page-skeleton" header={<HeaderSkeleton />}>
        <GroupSkeleton>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4">
            <div className="min-w-0">
              <span className="flex h-6 items-center">
                <Skeleton className="h-4 w-40" />
              </span>
              <span className="mt-0.5 flex h-4 items-center">
                <Skeleton className="h-2.5 w-52" />
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ButtonSkeleton className="w-[6.75rem]" />
              <ButtonSkeleton className="w-[4.5rem]" />
            </div>
          </div>
          <MeterRowSkeleton label="w-10" />
          <MeterRowSkeleton label="w-16" />
          <MeterRowSkeleton label="w-28" />
          <MeterRowSkeleton label="w-48" hint />
          <MeterRowSkeleton label="w-24" />
        </GroupSkeleton>
        <GroupSkeleton title="w-14">
          <RowSkeleton label="w-12" hint="w-44">
            <SmallButtonSkeleton className="w-[3.75rem]" />
          </RowSkeleton>
        </GroupSkeleton>
        <GroupSkeleton title="w-14">
          <RowSkeleton label="w-14" hint="w-48">
            <SmallButtonSkeleton className="w-[5.875rem]" />
          </RowSkeleton>
        </GroupSkeleton>
      </SettingsPageSkeleton>
    );
  return (
    <SettingsPageSkeleton testId="billing-page-skeleton" header={<HeaderSkeleton sub />}>
      <GroupSkeleton title="w-10" hint="w-20">
        <MeterRowSkeleton label="w-10" />
        <MeterRowSkeleton label="w-16" />
        <MeterRowSkeleton label="w-48" hint />
        <MeterRowSkeleton label="w-40" />
      </GroupSkeleton>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex h-5 items-center gap-3">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-2.5 w-44" />
          </div>
          <SegmentedSkeleton labels={[45, 87]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {planFeatureLines.map((lines) => (
            <PlanCardSkeleton key={lines.length} lines={lines} />
          ))}
        </div>
      </section>
    </SettingsPageSkeleton>
  );
}

/**
 * /settings: Account (the picture and name with Save beside them, the
 * email, the theme), Signing in (password, Google, other devices) and the
 * delete-account group outlined in the danger colour, `gap-8` apart in the
 * settings column. The Google row only exists where Google sign-in is on.
 */
export function SettingsSkeleton() {
  return (
    <SettingsPageSkeleton testId="settings-page-skeleton" header={<HeaderSkeleton />}>
      <GroupSkeleton title="w-14">
        <RowSkeleton label="w-10">
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-9 min-w-0 flex-1 rounded-lg sm:w-56 sm:flex-none" />
            <ButtonSkeleton className="w-[3.75rem]" />
          </div>
        </RowSkeleton>
        <RowSkeleton label="w-10">
          <span className="flex h-5 items-center">
            <Skeleton className="h-2.5 w-48" />
          </span>
        </RowSkeleton>
        <RowSkeleton label="w-12">
          <SegmentedSkeleton labels={[29, 28]} />
        </RowSkeleton>
      </GroupSkeleton>
      <GroupSkeleton title="w-16">
        <RowSkeleton label="w-16">
          <SmallButtonSkeleton className="w-[7.5rem]" />
        </RowSkeleton>
        <RowSkeleton label="w-12" hint="w-56">
          <SmallButtonSkeleton className="w-20" />
        </RowSkeleton>
        <RowSkeleton label="w-24" hint="w-48" />
      </GroupSkeleton>
      <GroupSkeleton danger>
        <RowSkeleton label="w-28" hint="w-56">
          <ButtonSkeleton className="w-[4.25rem]" />
        </RowSkeleton>
      </GroupSkeleton>
    </SettingsPageSkeleton>
  );
}

/** ApiTabBar: "API keys", "MCP" and the Docs link as underline tabs over a
 * hairline, `mb-5`. Shared by both tab skeletons below so switching tabs (or
 * reloading on either one) never moves the bar itself. */
function ApiTabBarSkeleton() {
  return <TabsSkeleton tabs={["w-14", "w-8", "w-12"]} className="mb-5" />;
}

/** /api-keys?tab=keys (the default): Create key beside the title (the keys
 * are the owner's, and so is this tab), then the keys table, Name, Key
 * (from `sm`), Created (from `md`) and Last used, in 41px rows. */
export function ApiKeysSkeleton() {
  return (
    <SkeletonStatus testId="api-keys-page-skeleton">
      <HeaderSkeleton sub subWidth="w-60" action={<ButtonSkeleton className="w-[7.5rem]" />} />
      <ApiTabBarSkeleton />
      <TableFrameSkeleton
        head={
          <>
            <HeadCellSkeleton className="min-w-0 flex-1" bar="w-10" />
            <HeadCellSkeleton className="hidden w-56 shrink-0 sm:flex" bar="w-8" />
            <HeadCellSkeleton className="hidden w-52 shrink-0 md:flex" bar="w-14" />
            <HeadCellSkeleton className="w-32 shrink-0" bar="w-14" />
            <HeadCellSkeleton className="w-14 shrink-0" />
          </>
        }
      >
        {["w-24", "w-32", "w-20"].map((w) => (
          <div
            key={w}
            className="flex h-[41px] items-center border-b border-border/50 last:border-b-0"
          >
            <div className="min-w-0 flex-1 px-4">
              <Skeleton className={cn("h-3.5", w)} />
            </div>
            <div className="hidden w-56 shrink-0 px-4 sm:block">
              <Skeleton className="h-2.5 w-24" />
            </div>
            <div className="hidden w-52 shrink-0 px-4 md:block">
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="w-32 shrink-0 px-4">
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="w-14 shrink-0" />
          </div>
        ))}
      </TableFrameSkeleton>
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
      <HeaderSkeleton sub subWidth="w-60" />
      <ApiTabBarSkeleton />
      <TableSkeleton rows={3} />
    </SkeletonStatus>
  );
}

/** The QR editor's rows: label width and row height (Colours holds two
 * lines of controls). */
const qrEditorRows = [
  { label: "w-10", h: "h-16" },
  { label: "w-14", h: "h-16" },
  { label: "w-16", h: "h-28" },
  { label: "w-12", h: "h-16" },
];

/**
 * /organization, as its owner sees it: the name row (field and Save), the
 * default domain and the ID, the QR code defaults editor, and the delete
 * group outlined in the danger colour. Every plan shows the editor; a free
 * one adds a one-line strip under it, the second last thing on the page.
 */
export function OrganizationSkeleton() {
  return (
    <SettingsPageSkeleton testId="organization-page-skeleton" header={<HeaderSkeleton />}>
      <GroupSkeleton>
        <RowSkeleton label="w-10">
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Skeleton className="h-9 min-w-0 flex-1 rounded-lg sm:w-60 sm:flex-none" />
            <ButtonSkeleton className="w-[3.75rem]" />
          </div>
        </RowSkeleton>
        <RowSkeleton label="w-24" hint="w-56">
          <span className="flex h-5 items-center">
            <Skeleton className="h-2.5 w-36" />
          </span>
        </RowSkeleton>
        <RowSkeleton label="w-32" hint="w-20">
          <Skeleton className="h-2.5 w-56 max-w-[70%]" />
          <Skeleton className="size-6 rounded-md" />
        </RowSkeleton>
      </GroupSkeleton>
      <GroupSkeleton title="w-28" hint="w-80">
        {/* The QR editor every plan shows (inert on a free one): Dots,
            Corners, Colours and Logo rows, the preview beside them (on a
            phone, above). */}
        <div className="grid overflow-hidden rounded-xl sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="flex min-w-0 flex-col px-4 py-1 max-sm:order-last">
            {qrEditorRows.map(({ label, h }) => (
              <div key={label} className={cn("flex items-center justify-between gap-4", h)}>
                <Skeleton className={cn("h-3", label)} />
                <Skeleton className="h-9 w-40 rounded-lg" />
              </div>
            ))}
          </div>
          <div className="flex justify-center bg-bg p-4">
            <Skeleton className="size-[170px] rounded-[14px]" />
          </div>
        </div>
      </GroupSkeleton>
      <GroupSkeleton danger>
        <RowSkeleton label="w-36" hint="w-64">
          <ButtonSkeleton className="w-[4.25rem]" />
        </RowSkeleton>
      </GroupSkeleton>
    </SettingsPageSkeleton>
  );
}

/**
 * /links/:slug: the 56px QR code beside the title over the short address,
 * and on the right the range (three segments), Edit, QR code and the 36px
 * menu (on a phone, a row of their own). Then the main column (the
 * three-figure strip over the chart, then Countries and Referrers cut at
 * seven rows) beside the 16rem facts card, which drops under it below `lg`.
 */
export function LinkDetailSkeleton() {
  return (
    <SkeletonStatus>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-4">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <Skeleton className="size-14 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <span className="flex h-7 items-center">
              <Skeleton className="h-5 w-40" />
            </span>
            <span className="mt-0.5 flex h-6 items-center">
              <Skeleton className="h-3 w-48" />
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:flex-wrap">
          <SegmentedSkeleton
            labels={[RANGE_LABEL["7d"], RANGE_LABEL["30d"], RANGE_LABEL["365d"]]}
          />
          <div className="flex items-center gap-2 max-sm:ml-auto">
            <SmallButtonSkeleton className="w-[2.625rem]" />
            <SmallButtonSkeleton className="w-[5.5rem]" />
            <Skeleton className="size-9 rounded-lg" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <StatsChartSkeleton figures={3} chartHeight={180} />
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <PanelSkeleton tabs={["w-16", "w-8"]}>
              <BarListSkeleton rows={7} more />
            </PanelSkeleton>
            <PanelSkeleton tabs={["w-16", "w-14"]}>
              <BarListSkeleton rows={7} more />
            </PanelSkeleton>
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-xl bg-surface p-4 smooth-shadow-ring-xs">
          <FactSkeleton label="w-16" value="w-full" lines={2} />
          <div className="grid grid-cols-2 gap-3">
            <FactSkeleton label="w-12" value="w-16" />
            <FactSkeleton label="w-6" value="w-20" />
          </div>
          <FactSkeleton label="w-14" value="w-24" />
          <div>
            <SmallButtonSkeleton className="w-[6.5rem]" />
          </div>
        </div>
      </div>
    </SkeletonStatus>
  );
}

/** One fact in the link's side card: a text-xs label over text-sm lines. */
function FactSkeleton({
  label,
  value,
  lines = 1,
}: {
  label: string;
  value: string;
  lines?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex h-4 items-center">
        <Skeleton className={cn("h-2.5", label)} />
      </span>
      {/* wrapped lines of one value, so no gap between them */}
      <span className="flex flex-col">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={cn("h-5 items-center", i > 0 ? "hidden lg:flex" : "flex")}>
            <Skeleton className={cn("h-3", i === lines - 1 && lines > 1 ? "w-2/3" : value)} />
          </span>
        ))}
      </span>
    </div>
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
  "/admin": AdminPlatformSkeleton,
} satisfies Record<string, () => ReactElement>;

/** /api-keys carries which of its two tabs is open in ?tab=, not in the
 * path, so PAGE_SKELETONS can't tell them apart on its own. */
function apiKeysSkeletonFor(search: string): () => ReactElement {
  return new URLSearchParams(search).get("tab") === "mcp" ? McpTabSkeleton : ApiKeysSkeleton;
}

function skeletonFor(pathname: string, search: string): () => ReactElement {
  // The two routes with something after the prefix: an admin tab is the
  // Platform frame over a table, and a single link is its own page.
  if (pathname.startsWith("/admin/")) return AdminPlatformSkeleton;
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
