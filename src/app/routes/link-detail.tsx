import { Link, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useLinkStats } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { AreaChart, BarList, StatCard } from "../components/charts";
import { Card } from "../ui/misc";
import { Button } from "../ui/button";

const COUNTRY_NAMES = new Intl.DisplayNames("en", { type: "region" });
const fmtCountry = (key: string) => {
  try { return COUNTRY_NAMES.of(key) ?? key; } catch { return key; }
};

export function LinkDetailPage() {
  const { linkId } = useParams<{ linkId: string }>();
  const { org } = useCurrentOrg();
  const stats = useLinkStats(org?.id ?? "", linkId ?? null);

  if (!org) return null;
  if (stats.isLoading) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  if (!stats.data)
    return <p className="py-8 text-center text-sm text-danger">Could not load link stats.</p>;
  const s = stats.data;

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link to="/links">
          <Button variant="ghost" size="sm" className="p-1">
            <ArrowLeft size={16} />
          </Button>
        </Link>
        <div>
          <h1 className="text-lg font-bold tracking-wide">/{s.slug}</h1>
          <p className="mt-1 text-sm text-muted">{s.title || s.destination}</p>
        </div>
      </div>

      <Card className="mb-4 max-w-lg">
        <div className="flex flex-col gap-1 text-sm">
          <p className="truncate text-muted">
            Destination:{" "}
            <a
              href={s.destination}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {s.destination}
            </a>
          </p>
          <p className="text-muted">
            Created:{" "}
            <span className="tnum text-text">
              {new Date(s.createdAt).toLocaleDateString()}
            </span>
          </p>
          {s.lastClick && (
            <p className="text-muted">
              Last click:{" "}
              <span className="tnum text-text">
                {new Date(s.lastClick).toLocaleDateString()}
              </span>
            </p>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total clicks" value={s.totalClicks} delta={s.totalClicksDelta} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} delta={s.clicks7dDelta} />
      </div>

      <Card className="mt-4">
        <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
          Clicks per day
        </p>
        <AreaChart data={s.series} />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
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
        <Card>
          <p className="mb-3 text-[11px] tracking-wider text-muted uppercase">
            Devices
          </p>
          <BarList items={s.devices} />
        </Card>
      </div>
    </div>
  );
}
