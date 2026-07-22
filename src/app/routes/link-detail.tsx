import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useLinkStats } from "../lib/hooks";
import { shortDate, relativeDate } from "../lib/dates";
import { useCurrentOrg } from "../lib/current-org";
import { useConfig } from "../lib/hooks";
import { shortUrl } from "../lib/api";
import { AreaChart, StatCard, ClickBreakdown } from "../components/charts";
import { NoOrgState } from "../components/no-org";
import { Card } from "../ui/misc";

export function LinkDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const domain = searchParams.get("domain");
  const { org } = useCurrentOrg();
  const { data: config } = useConfig();
  const stats = useLinkStats(org?.id ?? "", slug ?? null, domain);

  if (!org) return <NoOrgState />;
  if (stats.isLoading) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  if (!stats.data)
    return <p className="py-8 text-center text-sm text-danger">Could not load link stats.</p>;
  const s = stats.data;

  const fullUrl = shortUrl(s.slug, s.domain);

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link to="/links">
          <button type="button" aria-label="Back to links" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text">
            <ArrowLeft size={16} />
          </button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold tracking-wide">
            {config?.appHost && s.domain
              ? `${s.domain}/${s.slug}`
              : config?.appHost
                ? `${new URL(config.appHost).host}/${s.slug}`
                : `/${s.slug}`}
          </h1>
          {s.title && (
            <p className="mt-0.5 truncate text-sm text-muted">{s.title}</p>
          )}
        </div>
        <a
          href={fullUrl}
          target="_blank"
          rel="noreferrer"
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Open link in new tab"
          title={fullUrl}
        >
          <ExternalLink size={14} />
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total clicks" value={s.totalClicks} delta={s.totalClicksDelta} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} delta={s.clicks7dDelta} />
        <StatCard label="Range" value={s.rangeDays} prefix="Last " suffix=" days" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
            Clicks per day
          </p>
          <AreaChart data={s.series} />
        </Card>

        <Card>
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">
            Info
          </p>
          <div className="flex flex-col gap-2 text-sm">
            <div className="min-w-0">
              <p className="text-3xs tracking-wider text-muted uppercase">Destination</p>
              <a
                href={s.destination}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-accent hover:underline"
              >
                {s.destination}
              </a>
            </div>
            <div>
              <p className="text-3xs tracking-wider text-muted uppercase">Created</p>
              <p className="tnum text-text">{shortDate(s.createdAt)}</p>
            </div>
            {s.lastClick && (
              <div>
                <p className="text-3xs tracking-wider text-muted uppercase">Last click</p>
                <p className="tnum text-text">{shortDate(s.lastClick)}</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ClickBreakdown
          countries={s.countries}
          referrers={s.referrers}
          devices={s.devices}
        />
      </div>
    </div>
  );
}
