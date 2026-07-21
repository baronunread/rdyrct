import { useState } from "react";
import { Link } from "react-router";
import { useStats } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { PLAN_LIMITS } from "@/shared/types";
import {
  AreaChart,
  BarList,
  StatCard,
  Heatmap,
  LinkListCard,
} from "../components/charts";
import { DashboardSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { Card, PageHeader } from "../ui/misc";

const COUNTRY_NAMES = new Intl.DisplayNames("en", { type: "region" });
const fmtCountry = (key: string) => {
  try { return COUNTRY_NAMES.of(key) ?? key; } catch { return key; }
};

const RANGE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "365d", days: 365 },
] as const;

export function Dashboard() {
  const { org } = useCurrentOrg();
  const [rangeDays, setRangeDays] = useState<number | undefined>(undefined);
  const stats = useStats(org?.id ?? "", rangeDays);

  if (!org) return <NoOrgState />;
  if (stats.isLoading) return <DashboardSkeleton />;
  if (!stats.data)
    return <p className="text-sm text-danger">Could not load stats.</p>;
  const s = stats.data;
  const noLinks = s.totalLinks === 0;
  const maxDays = PLAN_LIMITS[org.plan].analyticsDays;
  const presets = RANGE_PRESETS.filter((p) => p.days <= maxDays);
  const currentLabel = presets.find((p) => p.days === (rangeDays ?? s.rangeDays))?.label ?? `${rangeDays ?? s.rangeDays}d`;

  const setRange = (days: number) => setRangeDays(days === s.rangeDays ? undefined : days);

  return (
    <div>
      <PageHeader
        title="Overview"
        sub={`Last ${s.rangeDays} days`}
        action={
          <div className="flex items-center gap-1.5">
            {presets.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setRange(p.days)}
                className={`cursor-pointer rounded-md px-2 py-1 text-xs transition-colors ${
                  (rangeDays ?? s.rangeDays) === p.days
                    ? "bg-accent text-white"
                    : "text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />
      {noLinks && (
        <div className="mb-6 rounded-lg border border-accent/20 bg-accent/5 p-4 text-sm">
          <p className="font-bold text-accent">Welcome to rdyrct</p>
          <p className="mt-1 text-muted">
            Create your first short link to see analytics here.
          </p>
          <Link
            to="/links"
            className="mt-2 inline-block text-accent hover:underline"
          >
            Create a link
          </Link>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total clicks"
          value={s.totalClicks}
          delta={s.totalClicksDelta}
        />
        <StatCard
          label="Clicks · 7d"
          value={s.clicks7d}
          delta={s.clicks7dDelta}
        />
        <StatCard label="Active links" value={s.totalLinks} />
      </div>

      <Card className="mt-4">
        <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
          Clicks per day
        </p>
        <AreaChart data={s.series} />
      </Card>

      {s.campaigns.length > 0 && (
        <Card className="mt-4">
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Campaigns
          </p>
          <BarList items={s.campaigns.map((c) => ({ key: c.campaign, clicks: c.clicks }))} />
        </Card>
      )}

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
            <p className="py-4 text-sm text-muted">No data yet</p>
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
          <BarList
            items={s.countries.map((c) => ({ ...c, key: fmtCountry(c.key) }))}
          />
        </Card>
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Referrers
          </p>
          <BarList items={s.referrers} />
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LinkListCard
          title="Dead links"
          links={s.deadLinks.map((l) => ({ ...l, suffix: "0 clicks in 30d" }))}
        />
        <LinkListCard
          title="Decaying links"
          links={s.decayingLinks.map((l) => ({ ...l, suffix: `${l.drop}% drop` }))}
        />
      </div>

      {s.heatmap.length > 0 && (
        <Card className="mt-4">
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Activity heatmap
          </p>
          <Heatmap data={s.heatmap} />
        </Card>
      )}
    </div>
  );
}
