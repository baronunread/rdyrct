import type { ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useSearchParams } from "../lib/router-search";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useLinkStats, useCurrentUser } from "../lib/hooks";
import { shortDate } from "../lib/dates";
import { useCurrentOrg } from "../lib/current-org";
import { useConfig } from "../lib/hooks";
import { shortUrl } from "../lib/api";
import { AreaChart, StatCard, ClickBreakdown } from "../components/charts";
import { NoOrgState } from "../components/no-org";
import { ExportCsvButton } from "../components/export-csv-button";
import { Card } from "../ui/misc";
import { linkDisplayTitle } from "../lib/link-display";

function LinkDetailHeader({
  title,
  subtitle,
  fullUrl,
  action,
}: {
  title: string;
  subtitle?: string | null;
  fullUrl: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <Link to="/links">
        <button
          type="button"
          aria-label="Back to links"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeft size={16} />
        </button>
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-bold tracking-wide">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
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
  );
}

function LinkInfoCard({
  destination,
  createdAt,
  lastClick,
}: {
  destination: string;
  createdAt: number;
  lastClick: number | null;
}) {
  return (
    <Card>
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Info</p>
      <div className="flex flex-col gap-2 text-sm">
        <div className="min-w-0">
          <p className="text-3xs tracking-wider text-muted uppercase">Destination</p>
          <a
            href={destination}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-accent hover:underline"
          >
            {destination}
          </a>
        </div>
        <div>
          <p className="text-3xs tracking-wider text-muted uppercase">Created</p>
          <p className="tnum text-text">{shortDate(createdAt)}</p>
        </div>
        {lastClick && (
          <div>
            <p className="text-3xs tracking-wider text-muted uppercase">Last click</p>
            <p className="tnum text-text">{shortDate(lastClick)}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

export function LinkDetailPage() {
  const { slug } = useParams({ strict: false });
  const [searchParams] = useSearchParams();
  const domain = searchParams.get("domain");
  const { org } = useCurrentOrg();
  const currentUser = useCurrentUser();
  const { data: config } = useConfig();
  const stats = useLinkStats(org?.id ?? "", slug ?? null, domain);

  if (currentUser.isLoading) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  if (!org) return <NoOrgState />;
  if (stats.isLoading) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  if (!stats.data)
    return <p className="py-8 text-center text-sm text-danger">Could not load link stats.</p>;
  const s = stats.data;

  const fullUrl = shortUrl(s.slug, s.domain);

  return (
    <div>
      <LinkDetailHeader
        title={linkDisplayTitle(config?.appHost, s.domain, s.slug)}
        subtitle={s.title}
        fullUrl={fullUrl}
        action={<ExportCsvButton stats={s} scope={`link-${s.slug}`} days={s.rangeDays} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total clicks" value={s.totalClicks} delta={s.totalClicksDelta} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} delta={s.clicks7dDelta} />
        <StatCard label="Range" value={s.rangeDays} prefix="Last " suffix=" days" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Clicks per day</p>
          <AreaChart data={s.series} />
        </Card>

        <LinkInfoCard destination={s.destination} createdAt={s.createdAt} lastClick={s.lastClick} />
      </div>

      <div className="mt-4">
        <ClickBreakdown countries={s.countries} referrers={s.referrers} devices={s.devices} />
      </div>
    </div>
  );
}
