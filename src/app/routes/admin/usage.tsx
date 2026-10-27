import type { ReactNode } from "react";
import { useAdminUsage } from "../../lib/hooks";
import { AreaChart, BarList, StatsChart } from "../../components/charts";
import { PageHeader } from "../../ui/misc";
import { PanelTabs } from "../../ui/tabs";
import { AdminUsageSkeleton } from "../../components/skeletons";
import { cn } from "../../ui/cn";
import { linkLabel } from "./util";
import type { AdminUsage } from "@/shared/types";
import { shortDate } from "../../lib/dates";
import { formatNumber } from "../../lib/numbers";

/** "Oct 5" from "2026-10-05", as on the analytics page. */
const dayTick = (day: string) =>
  new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function Chart({ data }: { data: AdminUsage["series"] }) {
  return <AreaChart data={data} tickFormat={dayTick} />;
}

/**
 * People and money, over the chart of sign-ups. Access and money are
 * separate questions (#82): "Paid users" is who actually pays, comps
 * excluded; "Subscribers" is how many people hold a real Polar subscription.
 * No money here: Polar knows what it charged, net of discounts, tax and
 * refunds, so revenue is read there.
 */
function PeopleCard({ s }: { s: AdminUsage }) {
  return (
    <StatsChart
      figures={[
        { label: "Signups · 7d", value: formatNumber(s.signups7d), delta: s.signups7dDelta },
        { label: "Users", value: formatNumber(s.users) },
        { label: "Paid users", value: formatNumber(s.payingUsers) },
        { label: "Subscribers", value: formatNumber(s.payingSubscribers) },
        { label: "Weekly active users", value: formatNumber(s.wau) },
      ]}
    >
      <p className="mb-1 text-xs text-muted">Signups per day, last 30 days</p>
      <Chart data={s.signups} />
    </StatsChart>
  );
}

/** What everyone made, over the chart of clicks. */
function ResourcesCard({ s }: { s: AdminUsage }) {
  return (
    <StatsChart
      figures={[
        { label: "Clicks · 7d", value: formatNumber(s.clicks7d) },
        { label: "Clicks", value: formatNumber(s.clicks) },
        { label: "Links", value: formatNumber(s.links) },
        { label: "Orgs", value: formatNumber(s.orgs) },
      ]}
    >
      <p className="mb-1 text-xs text-muted">Clicks per day, last 30 days</p>
      <Chart data={s.series} />
    </StatsChart>
  );
}

function PlanMix({ s }: { s: AdminUsage }) {
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
                {s.paidConversionRate !== null && `${s.paidConversionRate}% paid conversion · `}
                {s.compedUsers} comped
              </p>
            </>
          ),
        },
      ]}
    />
  );
}

/** A count against its ceiling, as a bar and as figures. */
function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 py-2 text-sm [&+&]:shadow-[inset_0_1px_0_var(--border)]">
      <span className="truncate">{label}</span>
      <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="tnum text-right">
        {formatNumber(value)} <span className="text-muted">of {formatNumber(max)}</span>
      </span>
    </div>
  );
}

/** Calls to Google Web Risk, against the cap the Worker enforces each day
 * and Google's free 100,000 a month. */
function WebRisk({ s }: { s: AdminUsage }) {
  return (
    <PanelTabs
      tabs={[
        {
          value: "web-risk",
          label: "Google Web Risk",
          panel: (
            <div>
              <Meter
                label="Google lookups · today"
                value={s.webRisk.today}
                max={s.webRisk.perDay}
              />
              <Meter label="Google lookups · month" value={s.webRisk.month} max={100_000} />
            </div>
          ),
        },
      ]}
    />
  );
}

function Growth({ s }: { s: AdminUsage }) {
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

function TableSize({ s }: { s: AdminUsage }) {
  const projectedDate =
    s.tableProjectedDays !== null && s.tableProjectedDays > 0
      ? new Date(Date.now() + s.tableProjectedDays * 86400000)
      : null;
  return (
    <>
      <p className="mb-1 text-xs text-muted">
        <span className="tnum">{formatNumber(s.tableSize)}</span> rows
      </p>
      <Chart data={s.tableGrowth} />
      {projectedDate && s.tableProjectedDays !== null && (
        <p className="mt-3 text-xs text-muted">
          About <span className="tnum">{formatNumber(s.tableProjectedDays)}</span> days until the 10
          GB cap, around {shortDate(projectedDate)}.
        </p>
      )}
    </>
  );
}

function Health({ s }: { s: AdminUsage }) {
  return (
    <PanelTabs
      tabs={[
        { value: "bots", label: "Bot clicks · 30d", panel: <Chart data={s.botSeries} /> },
        { value: "table", label: "Clicks table", panel: <TableSize s={s} /> },
      ]}
    />
  );
}

function TopLists({ s }: { s: AdminUsage }) {
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
function CapCell({ pct }: { pct: number }) {
  const over = pct > 100;
  return (
    <td className="py-2 pl-3">
      <span className="flex items-center justify-end gap-2">
        <span className={cn("tnum text-sm", over ? "font-semibold text-danger" : "text-muted")}>
          {pct}%{over && " · over"}
        </span>
        <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-surface-2">
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
 * surface, so the kit's Table, which brings its own, would nest a card. */
function PanelTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="text-xs text-muted [&>th]:pb-2 [&>th]:font-normal">{head}</tr>
        </thead>
        <tbody className="[&>tr]:shadow-[inset_0_1px_0_var(--border)]">{children}</tbody>
      </table>
    </div>
  );
}

/** Orgs pressing on their plan, and orgs whose traffic jumped. Only the lists
 * that have rows get a tab. */
function Watchlists({ s }: { s: AdminUsage }) {
  const tabs: { value: string; label: string; panel: ReactNode }[] = [];
  if (s.capPressure.length > 0)
    tabs.push({
      value: "caps",
      label: "Over or near their plan",
      panel: (
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
          {s.capPressure.map((c) => (
            <tr key={c.orgId}>
              <td className="max-w-48 truncate py-2 font-semibold">{c.orgName}</td>
              <td className="py-2 text-muted capitalize">{c.plan}</td>
              <CapCell pct={c.linksPct} />
              <CapCell pct={c.membersPct} />
              <CapCell pct={c.domainsPct} />
            </tr>
          ))}
        </PanelTable>
      ),
    });
  if (s.anomalies.length > 0)
    tabs.push({
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
              <td className="max-w-48 truncate py-2 font-semibold">{a.orgName}</td>
              <td className="tnum py-2 text-right">{formatNumber(a.clicks24h)}</td>
              <td className="tnum py-2 text-right text-muted">{a.avg14d}</td>
              <td className="tnum py-2 text-right font-semibold text-danger">{a.ratio}x</td>
            </tr>
          ))}
        </PanelTable>
      ),
    });
  if (tabs.length === 0) return null;
  return <PanelTabs tabs={tabs} />;
}

export function AdminUsagePage() {
  const usage = useAdminUsage();
  if (usage.isLoading) return <AdminUsageSkeleton />;
  if (!usage.data) return <p className="text-sm text-danger">Could not load usage.</p>;
  const s = usage.data;

  return (
    <div>
      <PageHeader title="Platform usage" sub="Everything, across all organizations." />
      <div className="flex flex-col gap-6">
        <PeopleCard s={s} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PlanMix s={s} />
          <WebRisk s={s} />
        </div>
        <ResourcesCard s={s} />
        <TopLists s={s} />
        <Watchlists s={s} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Growth s={s} />
          <Health s={s} />
        </div>
      </div>
    </div>
  );
}
