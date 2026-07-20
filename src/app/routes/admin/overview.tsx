import { useAdminOverview } from "../../lib/hooks";
import { AreaChart, BarList, StatCard } from "../../components/charts";
import { Card, PageHeader } from "../../ui/misc";
import { AdminOverviewSkeleton } from "../../components/skeletons";
import { linkLabel } from "./util";

export function AdminOverviewPage() {
  const overview = useAdminOverview();
  if (overview.isLoading) return <AdminOverviewSkeleton />;
  if (!overview.data)
    return <p className="text-sm text-danger">Could not load usage.</p>;
  const s = overview.data;
  return (
    <div>
      <PageHeader
        title="Platform usage"
        sub="Everything, across all organizations"
      />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Users" value={s.users} />
        <StatCard label="Paid users" value={s.proUsers} />
        <StatCard label="Orgs" value={s.orgs} />
        <StatCard label="Links" value={s.links} />
        <StatCard label="Clicks" value={s.clicks} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Clicks per day · 30d
          </p>
          <AreaChart data={s.series} />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Signups per day · 30d
          </p>
          <AreaChart data={s.signups} />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Top organizations · 30d
          </p>
          <BarList
            items={s.topOrgs.map((o) => ({ key: o.id, clicks: o.clicks }))}
            formatKey={(id) =>
              s.topOrgs.find((o) => o.id === id)?.name ?? id
            }
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
    </div>
  );
}
