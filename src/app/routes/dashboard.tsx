import { useParams, Link } from "react-router";
import { useStats } from "../lib/hooks";
import { AreaChart, BarList, StatCard } from "../components/charts";
import { Card, PageHeader, Spinner } from "../ui/misc";

export function Dashboard() {
  const { orgId } = useParams<{ orgId: string }>();
  const stats = useStats(orgId!);

  if (stats.isLoading) return <Spinner />;
  if (!stats.data)
    return <p className="text-sm text-danger">Could not load stats.</p>;
  const s = stats.data;

  return (
    <div>
      <PageHeader title="Overview" sub="Last 30 days of activity" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total clicks" value={s.totalClicks} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} />
        <StatCard label="Active links" value={s.totalLinks} />
      </div>

      <Card className="mt-4">
        <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
          Clicks per day
        </p>
        <AreaChart data={s.series} />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Top links
          </p>
          {s.topLinks.length ? (
            <BarList
              items={s.topLinks.map((l) => ({
                key: `/${l.slug}${l.title ? ` · ${l.title}` : ""}`,
                clicks: l.clicks,
              }))}
            />
          ) : (
            <p className="py-4 text-sm text-muted">
              No links yet. <Link to={`/app/${orgId}/links`}>Create one</Link>.
            </p>
          )}
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Devices
          </p>
          <BarList items={s.devices} />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Countries
          </p>
          <BarList items={s.countries} />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Referrers
          </p>
          <BarList items={s.referrers} />
        </Card>
      </div>
    </div>
  );
}
