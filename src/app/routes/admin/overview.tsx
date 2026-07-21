import { useAdminOverview } from "../../lib/hooks";
import { AreaChart, BarList, StatCard } from "../../components/charts";
import { Badge, Card, PageHeader, Table, Th, Td } from "../../ui/misc";
import { AdminOverviewSkeleton } from "../../components/skeletons";
import { linkLabel } from "./util";
import type { OrgPlan } from "@/shared/types";

const planColor = (p: OrgPlan) =>
  p === "pro" ? "accent" : p === "hobby" ? "mint" : "muted";

function AdminTableCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="lg:col-span-2">
      <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
        {title}
      </p>
      <Table>{children}</Table>
    </Card>
  );
}

export function AdminOverviewPage() {
  const overview = useAdminOverview();
  if (overview.isLoading) return <AdminOverviewSkeleton />;
  if (!overview.data)
    return <p className="text-sm text-danger">Could not load usage.</p>;
  const s = overview.data;

  const projectedDate =
    s.tableProjectedDays !== null && s.tableProjectedDays > 0
      ? new Date(Date.now() + s.tableProjectedDays * 86400000)
      : null;

  return (
    <div>
      <PageHeader
        title="Platform usage"
        sub="Everything, across all organizations"
      />

      {/* ── Business stat cards ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Users" value={s.users} />
        <StatCard label="Paid users" value={s.proUsers} />
        <StatCard label="MRR" value={s.mrr} prefix="$" />
        <StatCard label="Signups · 7d" value={s.signups7d} delta={s.signups7dDelta} />
        <StatCard label="Weekly active users" value={s.wau} />
      </div>

      {/* ── Resource stat cards ── */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Orgs" value={s.orgs} />
        <StatCard label="Links" value={s.links} />
        <StatCard label="Clicks" value={s.clicks} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} />
      </div>

      {/* ── Business row ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Plan mix
          </p>
          <BarList
            items={[
              { key: "Free", clicks: s.planCounts.free },
              { key: "Hobby", clicks: s.planCounts.hobby },
              { key: "Pro", clicks: s.planCounts.pro },
            ]}
          />
          {s.paidConversionRate !== null && (
            <p className="mt-3 text-xs text-muted">
              {s.paidConversionRate}% paid conversion
            </p>
          )}
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Signups per day · 30d
          </p>
          <AreaChart data={s.signups} />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Cumulative users · 90d
          </p>
          <AreaChart data={s.cumulativeUsers} />
        </Card>
      </div>

      {/* ── Growth row ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Clicks per day · 30d
          </p>
          <AreaChart data={s.series} />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Orgs created per day · 90d
          </p>
          <AreaChart data={s.orgsCreatedPerWeek} />
        </Card>
      </div>

      {/* ── Top lists ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Top organizations · 30d
          </p>
          <BarList
            items={s.topOrgs.map((o) => ({ key: o.id, clicks: o.clicks }))}
            formatKey={(id) => {
              const o = s.topOrgs.find((t) => t.id === id);
              if (!o) return id;
              return (
                <span className="flex items-center gap-2">
                  {o.name}{" "}
                  <Badge color={planColor(o.plan as OrgPlan)}>
                    {o.plan}
                  </Badge>
                </span>
              );
            }}
          />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Top links · 30d
          </p>
          <BarList
            items={s.topLinks.map((l) => ({ key: l.id, clicks: l.clicks }))}
            formatKey={(id) => {
              const l = s.topLinks.find((t) => t.id === id);
              return l ? `${linkLabel(l)} · ${l.orgName}` : id;
            }}
          />
        </Card>
      </div>

      {/* ── Health row ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Bot clicks per day · 30d
          </p>
          <AreaChart data={s.botSeries} />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Table size
          </p>
          <div className="flex items-baseline gap-3">
            <span className="tnum text-2xl font-bold">
              {s.tableSize.toLocaleString()}
            </span>
            <span className="text-xs text-muted">rows</span>
          </div>
          <div className="mt-3">
            <AreaChart data={s.tableGrowth} height={60} />
          </div>
          {s.tableProjectedDays !== null && s.tableProjectedDays > 0 && projectedDate && (
            <div className="mt-2 text-xs text-muted">
              <p>
                ~{s.tableProjectedDays.toLocaleString()} days until 10 GB cap
              </p>
              <p>
                Estimated{" "}
                {projectedDate.toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
          )}
        </Card>
        {s.anomalies.length > 0 && (
          <AdminTableCard title="Anomaly watchlist">
            <thead>
              <tr>
                <Th>Organization</Th>
                <Th>Clicks 24h</Th>
                <Th>Daily avg 14d</Th>
                <Th>Ratio</Th>
              </tr>
            </thead>
            <tbody>
              {s.anomalies.map((a) => (
                <tr key={a.orgId}>
                  <Td>{a.orgName}</Td>
                  <Td className="tnum">{a.clicks24h.toLocaleString()}</Td>
                  <Td className="tnum">{a.avg14d}</Td>
                  <Td className="tnum font-bold text-danger">
                    {a.ratio}x
                  </Td>
                </tr>
              ))}
            </tbody>
          </AdminTableCard>
        )}
        {s.capPressure.length > 0 && (
          <AdminTableCard title="Cap pressure">
            <thead>
              <tr>
                <Th>Organization</Th>
                <Th>Links</Th>
                <Th>Members</Th>
                <Th>Domains</Th>
              </tr>
            </thead>
            <tbody>
              {s.capPressure.map((c) => (
                <tr key={c.orgId}>
                  <Td>
                    <span className="flex items-center gap-2">
                      {c.orgName}{" "}
                      <Badge color={planColor(c.plan)}>{c.plan}</Badge>
                    </span>
                  </Td>
                  <Td className="tnum">
                    <span
                      className={c.linksPct >= 100 ? "text-danger font-bold" : ""}
                    >
                      {c.linksPct}%
                    </span>
                  </Td>
                  <Td className="tnum">
                    <span
                      className={
                        c.membersPct >= 100 ? "text-danger font-bold" : ""
                      }
                    >
                      {c.membersPct}%
                    </span>
                  </Td>
                  <Td className="tnum">
                    <span
                      className={
                        c.domainsPct >= 100 ? "text-danger font-bold" : ""
                      }
                    >
                      {c.domainsPct}%
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </AdminTableCard>
        )}
      </div>
    </div>
  );
}
