import { useState, type ReactNode } from "react";
import { settle } from "../../lib/route-preload";
import { ArrowUp } from "@/app/ui/icons";
import { AreaChart, BarList } from "../../components/charts";
import { PanelTabs } from "../../ui/tabs";
import { AdminUsageSkeleton } from "../../components/skeletons";
import { cn } from "../../ui/cn";
import { linkLabel } from "./util";
import type { SeriesPoint } from "@/shared/types";
import { shortDate } from "../../lib/dates";
import type { QueryClient } from "@tanstack/react-query";
import { adminUsageQuery, useAdminUsageRange, type AdminUsageData } from "../../lib/admin-data";
import { SectionHeading, fullNumber } from "./admin-kit";
import { rangeDays, usageDaysFrom, useUsageRange } from "./usage-range";

/** "Oct 5" from "2026-10-05", as on the analytics page. */
const dayTick = (day: string) =>
  new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function Chart({ data, height }: { data: SeriesPoint[]; height?: number }) {
  return <AreaChart data={data} tickFormat={dayTick} height={height} />;
}

/** New per day, from a running total: each day minus the one before. The
 * first day has nothing before it, so it is dropped rather than guessed. */
function perDay(running: SeriesPoint[]): SeriesPoint[] {
  return running
    .slice(1)
    .map((point, i) => ({ day: point.day, clicks: point.clicks - (running[i]?.clicks ?? 0) }));
}

const total = (series: SeriesPoint[]) => series.reduce((sum, p) => sum + p.clicks, 0);

/** Sign-ups per day over the range: the daily series when it reaches that
 * far, otherwise the 90-day running total read day by day. */
function signupSeries(s: AdminUsageData, days: number): SeriesPoint[] {
  if (s.signups.length >= days) return s.signups.slice(-days);
  return perDay(s.cumulativeUsers).slice(-days);
}

type KpiId = "users" | "paid" | "orgs" | "links" | "clicks";

interface Kpi {
  id: KpiId;
  label: string;
  value: number;
  /** Beside the value: what the range added, or a share. */
  note?: ReactNode;
  /** What the chart plots when this figure is picked; null when the API
   * has no daily history for it yet. */
  series: SeriesPoint[] | null;
  /** Names the series above the chart. */
  per: string;
}

/** "↑ 9": what the range added. Mint, with the arrow, so the colour never
 * says it alone; the words are there for a screen reader. */
function Added({ n, days }: { n: number; days: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-accent-2">
      <ArrowUp size={12} aria-hidden />
      {fullNumber(n)}
      <span className="sr-only"> in the last {days} days</span>
    </span>
  );
}

function kpis(s: AdminUsageData, days: number): Kpi[] {
  const signups = signupSeries(s, days);
  const orgs = perDay(s.cumulativeOrgs).slice(-days);
  const clicks = s.series.slice(-days);
  const links = s.linkSeries?.slice(-days) ?? null;
  const paidShare = s.users > 0 ? Math.round((s.payingUsers / s.users) * 100) : 0;
  return [
    {
      id: "users",
      label: "Users",
      value: s.users,
      note: <Added n={total(signups)} days={signups.length} />,
      series: signups,
      per: "Sign-ups per day",
    },
    {
      id: "paid",
      label: "Paid",
      value: s.payingUsers,
      note: <span className="text-xs font-medium text-muted">{paidShare}% of users</span>,
      series: s.paidSeries?.slice(-days) ?? null,
      per: "People paying, per day",
    },
    {
      id: "orgs",
      label: "Organizations",
      value: s.orgs,
      note: <Added n={total(orgs)} days={orgs.length} />,
      series: orgs,
      per: "New organizations per day",
    },
    {
      id: "links",
      label: "Links",
      value: s.links,
      note: links ? <Added n={total(links)} days={links.length} /> : undefined,
      series: links,
      per: "New links per day",
    },
    {
      id: "clicks",
      label: "Clicks",
      value: s.clicks,
      note: <Added n={total(clicks)} days={clicks.length} />,
      series: clicks,
      per: "Clicks per day",
    },
  ];
}

const CHART_HEIGHT = 200;

/**
 * Five figures over one chart, and the chart plots the one picked
 * (rdyrct-design, "Stats and the chart share a card"). Each figure is a
 * toggle, so the shaded one is always the one the chart is drawing.
 */
function KpiChart({ s, days }: { s: AdminUsageData; days: number }) {
  const [picked, setPicked] = useState<KpiId>("users");
  const figures = kpis(s, days);
  const current = figures.find((f) => f.id === picked) ?? figures[0];
  const short = current?.series && current.series.length < days;
  return (
    <div className="rounded-xl bg-surface smooth-shadow-ring-xs">
      <div
        role="group"
        aria-label="Figure to chart"
        className="grid grid-cols-2 gap-1 p-1.5 sm:grid-cols-3 lg:grid-cols-5"
      >
        {figures.map((f) => {
          const on = f.id === picked;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked(f.id)}
              className={cn(
                "flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-[background-color,scale] duration-150 ease-out active:scale-[0.98]",
                on ? "bg-bg" : "[@media(hover:hover)]:hover:bg-surface-2/60",
              )}
            >
              <span className="truncate text-xs text-muted">{f.label}</span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="tnum text-xl leading-tight font-semibold tracking-tight">
                  {fullNumber(f.value)}
                </span>
                {f.note}
              </span>
            </button>
          );
        })}
      </div>
      <div className="px-4 pt-1 pb-3">
        <p className="mb-1 text-xs text-muted">
          {current?.per}
          {short && current?.series && `, last ${current.series.length} days only`}
        </p>
        {current?.series && current.series.length > 0 ? (
          <Chart data={current.series} height={CHART_HEIGHT} />
        ) : (
          // Never a made-up line: the box keeps the chart's height and says
          // why it is empty.
          <div
            className="grid place-items-center rounded-lg bg-surface-2/50 px-6 text-center text-sm text-pretty text-muted"
            style={{ height: CHART_HEIGHT }}
          >
            No daily history for this figure yet. The total above is current.
          </div>
        )}
      </div>
    </div>
  );
}

/** Feature access by plan, and sign-ups over the range. Access and money are
 * separate questions (#82): the plan mix counts comps, "pay" does not, and
 * subscriptions are Polar's own count. No money here: Polar knows what it
 * charged, net of discounts, tax and refunds. */
function PlanMix({ s, days }: { s: AdminUsageData; days: number }) {
  const signups = signupSeries(s, days);
  return (
    <PanelTabs
      tabs={[
        {
          value: "plans",
          label: "Plan mix",
          panel: (
            <>
              <BarList
                head={["Plan", "Users"]}
                items={[
                  { key: "Free", clicks: s.planCounts.free },
                  { key: "Hobby", clicks: s.planCounts.hobby },
                  { key: "Pro", clicks: s.planCounts.pro },
                ]}
              />
              {/* Comped belongs here rather than in a bar of its own: a comp is
                  not a fourth plan, it is how some of the Hobby and Pro rows
                  above were paid for, so a bar would count those people twice. */}
              <p className="mt-3 text-xs text-muted">
                <span className="tnum">{fullNumber(s.compedUsers)}</span> comped.{" "}
                {s.paidConversionRate !== null && (
                  <>
                    <span className="tnum">{s.paidConversionRate}%</span> pay.{" "}
                  </>
                )}
                <span className="tnum">{fullNumber(s.payingSubscribers)}</span>{" "}
                {s.payingSubscribers === 1 ? "subscription" : "subscriptions"}.
              </p>
            </>
          ),
        },
        {
          value: "signups",
          label: "Sign-ups",
          panel: s.signupsByPlan ? (
            <BarList
              head={["Plan", "Sign-ups"]}
              items={[
                { key: "Free", clicks: s.signupsByPlan.free },
                { key: "Hobby", clicks: s.signupsByPlan.hobby },
                { key: "Pro", clicks: s.signupsByPlan.pro },
              ]}
            />
          ) : (
            <SignupFigures s={s} signups={signups} days={days} />
          ),
        },
      ]}
    />
  );
}

/** Sign-ups as figures, until the API says which plan each one took. */
function SignupFigures({
  s,
  signups,
  days,
}: {
  s: AdminUsageData;
  signups: SeriesPoint[];
  days: number;
}) {
  const rows: [string, ReactNode][] = [
    [`Last ${days} days`, fullNumber(total(signups))],
    [
      "Last 7 days",
      <>
        {fullNumber(s.signups7d)}
        {s.signups7dDelta?.pct != null && (
          <span
            className={cn(
              "ml-2 text-xs",
              s.signups7dDelta.pct > 0
                ? "text-accent-2"
                : s.signups7dDelta.pct < 0
                  ? "text-danger"
                  : "text-muted",
            )}
          >
            {s.signups7dDelta.pct > 0 ? "+" : ""}
            {s.signups7dDelta.pct}% on the week before
          </span>
        )}
      </>,
    ],
    ["Signed in this week", fullNumber(s.wau)],
  ];
  return (
    <div>
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex h-9 items-center justify-between gap-3 text-sm [&+&]:shadow-[inset_0_1px_0_var(--border)]"
        >
          <span>{label}</span>
          <span className="tnum text-right">{value}</span>
        </div>
      ))}
    </div>
  );
}

/** A count against its ceiling, as a bar and as figures in full. */
function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="grid h-9 grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm [&+&]:shadow-[inset_0_1px_0_var(--border)]">
      <span className="truncate">{label}</span>
      <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="tnum text-right whitespace-nowrap">
        {fullNumber(value)} <span className="text-muted">of {fullNumber(max)}</span>
      </span>
    </div>
  );
}

/** Calls to Google Web Risk, against the cap the Worker enforces each day
 * and Google's free 100,000 a month. */
function WebRisk({ s }: { s: AdminUsageData }) {
  return (
    <PanelTabs
      tabs={[
        {
          value: "web-risk",
          label: "Google Web Risk",
          panel: (
            <div>
              <Meter label="Lookups today" value={s.webRisk.today} max={s.webRisk.perDay} />
              <Meter label="Lookups this month" value={s.webRisk.month} max={100_000} />
              <p className="mt-3 text-xs text-pretty text-muted">
                {fullNumber(s.webRisk.perDay)} lookups a day in all. Each free organization gets 50
                of those; paid ones have no cap of their own. A link made past the limit is not
                checked then; the daily rescan gets to it, free links first.
              </p>
            </div>
          ),
        },
      ]}
    />
  );
}

function Growth({ s }: { s: AdminUsageData }) {
  return (
    <PanelTabs
      end="90 days"
      tabs={[
        { value: "users", label: "Total users", panel: <Chart data={s.cumulativeUsers} /> },
        { value: "orgs", label: "Total orgs", panel: <Chart data={s.cumulativeOrgs} /> },
      ]}
    />
  );
}

function TableSize({ s }: { s: AdminUsageData }) {
  const projectedDate =
    s.tableProjectedDays !== null && s.tableProjectedDays > 0
      ? new Date(Date.now() + s.tableProjectedDays * 86400000)
      : null;
  return (
    <>
      <p className="mb-1 text-xs text-muted">
        <span className="tnum">{fullNumber(s.tableSize)}</span> rows
      </p>
      <Chart data={s.tableGrowth} />
      {projectedDate && s.tableProjectedDays !== null && (
        <p className="mt-3 text-xs text-muted">
          About <span className="tnum">{fullNumber(s.tableProjectedDays)}</span> days until the 10
          GB cap, around {shortDate(projectedDate)}.
        </p>
      )}
    </>
  );
}

function Health({ s }: { s: AdminUsageData }) {
  return (
    <PanelTabs
      tabs={[
        { value: "bots", label: "Bot clicks · 30d", panel: <Chart data={s.botSeries} /> },
        { value: "table", label: "Clicks table", panel: <TableSize s={s} /> },
      ]}
    />
  );
}

function TopLists({ s }: { s: AdminUsageData }) {
  return (
    <PanelTabs
      end="30 days"
      tabs={[
        {
          value: "orgs",
          label: "Top organizations",
          panel: (
            <BarList
              head={["Organization", "Clicks"]}
              items={s.topOrgs.map((o) => ({ key: o.id, clicks: o.clicks }))}
              formatKey={(id) => {
                const o = s.topOrgs.find((t) => t.id === id);
                if (!o) return id;
                // The plan is an attribute of the row: plain text, no pill.
                return (
                  <>
                    {o.name} <span className="text-muted capitalize">{o.plan}</span>
                  </>
                );
              }}
            />
          ),
        },
        {
          value: "links",
          label: "Top links",
          panel: (
            <BarList
              head={["Link", "Clicks"]}
              items={s.topLinks.map((l) => ({ key: l.id, clicks: l.clicks }))}
              formatKey={(id) => {
                const l = s.topLinks.find((t) => t.id === id);
                if (!l) return id;
                return (
                  <>
                    <span className="font-mono text-xs">{linkLabel(l)}</span>{" "}
                    <span className="text-muted">{l.orgName}</span>
                  </>
                );
              }}
            />
          ),
        },
      ]}
    />
  );
}

/** A share of a cap: red and named "over" past 100%, so the colour never
 * says it alone. */
function CapCell({ pct, label }: { pct: number; label: string }) {
  const over = pct > 100;
  return (
    <td
      data-label={label}
      className="py-2 pl-3 max-sm:inline-flex max-sm:items-center max-sm:gap-1 max-sm:p-0 max-sm:text-xs max-sm:before:text-muted max-sm:before:content-[attr(data-label)]"
    >
      <span className="flex items-center justify-end gap-2">
        <span className={cn("tnum text-sm", over ? "font-semibold text-danger" : "text-muted")}>
          {fullNumber(pct)}%{over && " · over"}
        </span>
        <span
          aria-hidden
          className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2 max-sm:hidden"
        >
          <span
            className={cn("block h-full rounded-full", pct >= 100 ? "bg-danger" : "bg-accent")}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </span>
      </span>
    </td>
  );
}

/** A plain table for inside a panel: the panel is already the raised
 * surface, so the kit's Table, which brings its own, would nest a card. On a
 * phone each row folds into a name over its figures. */
function PanelTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-1 px-1 sm:overflow-x-auto">
      <table className="w-full text-sm max-sm:block sm:min-w-[32rem]">
        <thead className="max-sm:sr-only">
          <tr className="text-xs text-muted [&>th]:pb-2 [&>th]:font-normal">{head}</tr>
        </thead>
        <tbody className="max-sm:block [&>tr]:shadow-[inset_0_1px_0_var(--border)] max-sm:[&>tr]:flex max-sm:[&>tr]:flex-wrap max-sm:[&>tr]:gap-x-4 max-sm:[&>tr]:gap-y-1 max-sm:[&>tr]:py-2.5">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/** How hard an org presses on its plan: the worst of its three shares. */
const worst = (c: AdminUsageData["capPressure"][number]) =>
  Math.max(c.linksPct, c.membersPct, c.domainsPct);

const FIRST = 5;

/**
 * Orgs pressing on their plan, worst first. Five show, and the rest are one
 * press away: every row stays reachable, none is dropped.
 */
function CapPressure({ s }: { s: AdminUsageData }) {
  const [all, setAll] = useState(false);
  const sorted = [...s.capPressure].sort((a, b) => worst(b) - worst(a));
  const shown = all ? sorted : sorted.slice(0, FIRST);
  const count = s.capPressureTotal ?? sorted.length;
  return (
    <PanelTabs
      end={
        <span className="tnum">
          Showing {fullNumber(shown.length)} of {fullNumber(count)}
        </span>
      }
      tabs={[
        {
          value: "caps",
          label: "Over or near their plan",
          panel: (
            <>
              <PanelTable
                head={
                  <>
                    <th className="text-left">Organization</th>
                    <th className="text-left">Plan</th>
                    <th className="text-right">Links</th>
                    <th className="text-right">Members</th>
                    <th className="text-right">Domains</th>
                  </>
                }
              >
                {shown.map((c) => (
                  <tr key={c.orgId}>
                    <td className="max-w-48 truncate py-2 font-semibold max-sm:w-[calc(100%-4rem)] max-sm:max-w-none max-sm:p-0">
                      {c.orgName}
                    </td>
                    <td className="py-2 text-muted capitalize max-sm:ml-auto max-sm:p-0">
                      {c.plan}
                    </td>
                    <CapCell pct={c.linksPct} label="Links" />
                    <CapCell pct={c.membersPct} label="Members" />
                    <CapCell pct={c.domainsPct} label="Domains" />
                  </tr>
                ))}
              </PanelTable>
              {sorted.length > FIRST && (
                <button
                  type="button"
                  aria-expanded={all}
                  onClick={() => setAll((v) => !v)}
                  className="mt-2 inline-flex h-8 cursor-pointer items-center rounded-lg px-2 text-sm font-medium text-accent transition-[background-color,scale] duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:bg-surface-2"
                >
                  {all ? "Show the worst 5" : `Show all ${fullNumber(sorted.length)}`}
                </button>
              )}
            </>
          ),
        },
      ]}
    />
  );
}

/** Orgs whose traffic jumped against their own two-week average. */
function Anomalies({ s }: { s: AdminUsageData }) {
  return (
    <PanelTabs
      tabs={[
        {
          value: "anomalies",
          label: "Unusual traffic",
          panel: (
            <PanelTable
              head={
                <>
                  <th className="text-left">Organization</th>
                  <th className="text-right">Clicks · 24h</th>
                  <th className="text-right">Daily average · 14d</th>
                  <th className="text-right">Ratio</th>
                </>
              }
            >
              {s.anomalies.map((a) => (
                <tr key={a.orgId}>
                  <td className="max-w-48 truncate py-2 font-semibold max-sm:w-full max-sm:max-w-none max-sm:p-0">
                    {a.orgName}
                  </td>
                  <td className="tnum py-2 text-right max-sm:p-0 max-sm:text-xs">
                    <span className="text-muted sm:hidden">24h </span>
                    {fullNumber(a.clicks24h)}
                  </td>
                  <td className="tnum py-2 text-right text-muted max-sm:p-0 max-sm:text-xs">
                    <span className="sm:hidden">Average </span>
                    {a.avg14d}
                  </td>
                  <td className="tnum py-2 text-right font-semibold text-danger max-sm:p-0 max-sm:text-xs">
                    {a.ratio}x
                  </td>
                </tr>
              ))}
            </PanelTable>
          ),
        },
      ]}
    />
  );
}

/** The usage page's first frame (see lib/route-preload.ts). */
export const preload = (qc: QueryClient, searchStr: string) =>
  settle([qc.ensureQueryData(adminUsageQuery(usageDaysFrom(searchStr)))]);

export function AdminUsagePage() {
  const [range] = useUsageRange();
  const days = rangeDays(range);
  const usage = useAdminUsageRange(days);
  if (usage.isLoading) return <AdminUsageSkeleton />;
  if (!usage.data) return <p className="text-sm text-danger">Could not load usage.</p>;
  const s = usage.data;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading>Usage</SectionHeading>
      <KpiChart s={s} days={days} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PlanMix s={s} days={days} />
        <WebRisk s={s} />
      </div>
      {s.capPressure.length > 0 && <CapPressure s={s} />}
      <TopLists s={s} />
      {s.anomalies.length > 0 && <Anomalies s={s} />}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Growth s={s} />
        <Health s={s} />
      </div>
    </div>
  );
}
