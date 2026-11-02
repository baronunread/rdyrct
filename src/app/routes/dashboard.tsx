import { useEffect, useMemo, useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { dashboardView } from "./dashboard-view";
import { HrefLink } from "../lib/router-search";
import type { QueryClient } from "@tanstack/react-query";
import {
  useLinks,
  useMembers,
  useRecentClicks,
  useClickUsage,
  linksQuery,
  membersQuery,
  recentClicksQuery,
  clickUsageQuery,
  linkQuotaUsageQuery,
} from "../lib/hooks";
import { preloadOrgDomains, useOrgLimits } from "../lib/org-limits";
import { settle, type PageContext } from "../lib/route-preload";
import { type LinkDTO, type OrgStats, type RecentClick, type StatsLinkRef } from "@/shared/types";
import { AreaChart, BarList, LinkBarLabel, StatsChart } from "../components/charts";
import { countryName } from "../lib/places";
import { linkPagePath } from "../lib/link-display";
import { dayTick, hourTick } from "../lib/dates";
import { useNewLink, NewLinkButton } from "../components/new-link-host";
import { RangeControl } from "../components/range-control";
import { Flag } from "../components/source-tile";
import { PanelTabs } from "../ui/tabs";
import { formatNumber } from "../lib/numbers";
import { DashboardSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { ClickCapBanner } from "../components/over-limit";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { PageHeader, SlugLink } from "../ui/misc";
import { Tooltip } from "../ui/tooltip";
import { relativeDate, shortDate } from "../lib/dates";
import {
  PRESET_24H,
  PRESET_30D,
  PRESET_7D,
  shortAgo,
  sourceLabel,
  insightStatsQuery,
  orgInsightsQuery,
  useInsightStats,
  type RangePreset,
} from "../lib/insights-data";
import { InsightsRow } from "../components/dashboard-insights";
import { settleSetup } from "../lib/setup-arrive";

/** The dashboard's ranges: a glance, not a report. Analytics adds 365d. */
const DASHBOARD_RANGES = [PRESET_24H, PRESET_7D, PRESET_30D] as const;
const DEFAULT_RANGE = PRESET_7D;
/** The newest links on the team activity tab. */
const RECENT_LINKS = { limit: 5 };

/** Everything the dashboard's first frame reads (see lib/route-preload.ts). */
export function preload(qc: QueryClient, orgId: string, { org, user }: PageContext) {
  return settle([
    qc.ensureQueryData(insightStatsQuery(orgId, DEFAULT_RANGE.days, DEFAULT_RANGE.bucket)),
    qc.ensureQueryData(linksQuery(orgId, RECENT_LINKS)),
    qc.ensureQueryData(membersQuery(orgId)),
    qc.ensureQueryData(recentClicksQuery(orgId)),
    qc.ensureQueryData(clickUsageQuery(orgId)),
    qc.ensureQueryData(linkQuotaUsageQuery(orgId)),
    qc.ensureQueryData(orgInsightsQuery(orgId, DEFAULT_RANGE.days)),
    preloadOrgDomains(qc, org, user),
  ]);
}

/** Link rows carry only the creator's user id; names come from the roster. */
function creatorNameFrom(memberNames: Map<string, string>, id: string | null): string {
  return (id && memberNames.get(id)) || "A former member";
}

/** Loads and shapes every data source the dashboard renders from. */
function useDashboardData(orgId: string, range: RangePreset) {
  const stats = useInsightStats(orgId, range.days, range.bucket);
  // Five, from the server, rather than every link the org owns sorted in the
  // browser: this card only ever showed the newest handful.
  const links = useLinks(orgId, RECENT_LINKS);
  const members = useMembers(orgId);
  const clicks = useRecentClicks(orgId);

  const recentLinks = links.data?.items ?? [];
  const memberNames = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.userId, m.name])),
    [members.data],
  );

  return {
    isLoading: [stats, links, members, clicks].some((q) => q.isLoading),
    stats: stats.data,
    /** The figures on screen are the last range's while the new one loads. */
    updating: stats.isPlaceholderData,
    recentLinks,
    creatorName: (id: string | null) => creatorNameFrom(memberNames, id),
    clicks: clicks.data ?? [],
  };
}

type DashboardData = ReturnType<typeof useDashboardData>;

/** The four figures over the chart. */
function dashboardFigures(s: OrgStats) {
  const top = s.countries[0];
  return [
    { label: "Clicks", value: formatNumber(s.totalClicks), delta: s.totalClicksDelta },
    { label: "Links clicked", value: formatNumber(s.linksClicked), delta: s.linksClickedDelta },
    {
      label: "Top country",
      value: top && top.key !== "unknown" ? countryName(top.key) : "None yet",
    },
    { label: "Top source", value: s.referrers[0] ? sourceLabel(s.referrers[0].key) : "None yet" },
  ];
}

/**
 * The dashboard once there is something to count: the range's clicks over
 * the chart, then two panels (rdyrct-design, "Panels hold lists behind
 * tabs"). The full report is Analytics.
 */
function DashboardBody({
  stats: s,
  data,
  days,
}: {
  stats: NonNullable<DashboardData["stats"]>;
  data: DashboardData;
  days: number;
}) {
  const attention = [
    ...s.decayingLinks.map((l) => ({ ...l, suffix: `${l.drop}% fewer clicks` })),
    ...s.deadLinks.map((l) => ({ ...l, suffix: "No clicks in 30 days" })),
  ];
  const hourly = s.bucket === "hour";
  // Before any link has a click in the range, the newest links stand in at
  // zero: a link made a moment ago is on the page, not missing from it.
  const topLinks: (StatsLinkRef & { clicks: number })[] = s.topLinks.length
    ? s.topLinks.slice(0, 6)
    : data.recentLinks.map((l) => ({ ...l, clicks: 0 }));
  return (
    <div
      aria-busy={data.updating}
      className={`flex flex-col gap-6 transition-opacity duration-200 ease-out ${data.updating ? "opacity-60" : ""}`}
    >
      <StatsChart figures={dashboardFigures(s)}>
        {/* Keyed on the range the data covers: a new range crossfades in
            once it arrives, instead of the line morphing between two
            different sets of days. */}
        <div key={`${s.rangeDays}-${s.bucket}`} className="chart-in">
          <AreaChart
            data={hourly ? s.hourSeries : s.series}
            tickFormat={hourly ? hourTick : dayTick}
          />
        </div>
      </StatsChart>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PanelTabs
          end={
            <HrefLink href="/links" className="[@media(hover:hover)]:hover:text-text">
              All links
            </HrefLink>
          }
          tabs={[
            {
              value: "top",
              label: "Top links",
              panel: (
                <BarList
                  empty="Your busiest links appear here once they start collecting clicks."
                  items={topLinks.map((l) => ({ key: l.id, clicks: l.clicks }))}
                  formatKey={(id) => {
                    const link = topLinks.find((l) => l.id === id);
                    return link ? (
                      <LinkBarLabel slug={link.slug} title={link.title} domain={link.domain} />
                    ) : (
                      id
                    );
                  }}
                />
              ),
            },
            {
              value: "attention",
              label: "Needs attention",
              count: attention.length > 0 ? attention.length : undefined,
              panel: <AttentionList rows={attention.slice(0, 6)} />,
            },
          ]}
        />
        <PanelTabs
          tabs={[
            {
              value: "clicks",
              label: "Recent clicks",
              panel: <RecentClicks clicks={data.clicks} />,
            },
            {
              value: "team",
              label: "Team activity",
              panel: <TeamActivity links={data.recentLinks} creatorName={data.creatorName} />,
            },
          ]}
        />
      </div>

      <InsightsRow days={days} />
    </div>
  );
}

/** Nothing to show until there is an organization and its numbers have
 * arrived. Separated from the page itself so the page is about the page. */
export function Dashboard() {
  const { org, orgId, currentUser } = useOrgLimits();
  const [range, setRange] = useState<RangePreset>(DEFAULT_RANGE);
  const data = useDashboardData(orgId, range);
  // Asked for alongside the stats rather than when the banner mounts, so it
  // has its (much cheaper) answer by the time the page draws and the banner
  // does not push the page down after it.
  useClickUsage(orgId);
  switch (dashboardView(currentUser.isLoading, !!org, data.isLoading, !!data.stats)) {
    case "userLoading":
    case "statsLoading":
      return <DashboardSkeleton />;
    case "noOrg":
      return <NoOrgState />;
    case "statsError":
      return <p className="text-sm text-danger">Could not load stats.</p>;
    case "ready":
      return (
        <DashboardScreen
          // SAFETY: dashboardView only returns "ready" once hasStats (!!data.stats) is true.
          stats={data.stats!}
          data={data}
          range={range}
          onRangeChange={setRange}
        />
      );
  }
}

/** The header's New link: live, greyed out for a read-only org, or absent
 * for somebody who could never make one. */
function NewLinkAction({
  canCreate,
  locked,
  onOpen,
}: {
  canCreate: boolean;
  locked: boolean;
  onOpen: () => void;
}) {
  if (!canCreate && !locked) return null;
  return (
    <div className="flex sm:order-last">
      {canCreate ? <NewLinkButton onClick={onOpen} /> : <ReadOnlyNewLinkButton />}
    </div>
  );
}

/** New link, greyed out, for an organization nobody can write to: the
 * button stays where people look for it and says why it does nothing. */
function ReadOnlyNewLinkButton() {
  return (
    <Tooltip content="This organization is read-only">
      <Button
        variant="primary"
        aria-disabled
        static
        className="cursor-not-allowed opacity-45"
        onClick={(e) => e.preventDefault()}
      >
        <IconPlus size={15} aria-hidden /> New link
        <Kbd tone="primary" className="ml-0.5 max-sm:hidden">
          C
        </Kbd>
      </Button>
    </Tooltip>
  );
}

function DashboardScreen({
  stats: s,
  data,
  range,
  onRangeChange,
}: {
  stats: NonNullable<DashboardData["stats"]>;
  data: DashboardData;
  range: RangePreset;
  onRangeChange: (range: RangePreset) => void;
}) {
  const { org, limits, canWrite } = useOrgLimits();
  const { openNewLink, canCreate, busy } = useNewLink();

  // First run. An organization exists from the first session, so what is
  // missing is the link. The page keeps its header, the way Resend, Linear
  // and Stripe keep theirs, and one plain panel takes the place of the cards
  // with one button: three zeroes, four empty cards and a flat chart would
  // teach somebody the product is empty. The button opens the same New link
  // form as everywhere else, and once its "Link created" dialog closes the
  // dashboard fills in. Only for somebody who can make that link: a
  // read-only org or a viewer gets the dashboard as it is.
  const firstRun = useHeldFirstRun(s.totalLinks === 0 && canWrite, busy);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        action={
          // The range sits left of New link on a desktop, where the eye
          // ends on the primary action; on a phone New link comes first.
          // No range before the first link: there is nothing to range over.
          <div className="flex flex-wrap items-center gap-2">
            <NewLinkAction canCreate={canCreate} locked={!!org?.locked} onOpen={openNewLink} />
            {!firstRun && (
              <div data-setup-head className="flex">
                <RangeControl
                  presets={DASHBOARD_RANGES}
                  maxDays={limits.analyticsDays}
                  days={range.days}
                  bucket={range.bucket ?? "day"}
                  onChange={onRangeChange}
                />
              </div>
            )}
          </div>
        }
      />

      <ClickCapBanner />

      {firstRun ? (
        <FirstRun onCreate={openNewLink} />
      ) : (
        <div data-setup-body>
          <DashboardBody stats={s} data={data} days={range.days} />
        </div>
      )}
    </div>
  );
}

/**
 * Whether the page still shows the first run. Held while the first link is
 * being made and its "Link created" dialog is open, so the layout never
 * changes under the dialog; then it settles into the dashboard in one
 * transition (settleSetup). Going back to empty swaps the same way.
 */
function useHeldFirstRun(firstRun: boolean, holding: boolean): boolean {
  const [shown, setShown] = useState(firstRun);
  useEffect(() => {
    if (shown === firstRun || holding) return;
    // After the dialog's own exit, so the transition never freezes it
    // half faded into its first frame.
    const id = window.setTimeout(() => settleSetup(() => setShown(firstRun)), 220);
    return () => window.clearTimeout(id);
  }, [shown, firstRun, holding]);
  return shown;
}

/** A new account's dashboard under its header: one plain panel with a
 * title, one line and one button, the way an empty page looks in Resend or
 * Stripe. No feature list, no stand-in rows. */
function FirstRun({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="flex flex-col items-center rounded-xl bg-surface px-5 py-14 text-center smooth-shadow-ring-xs sm:py-20">
      <h2 className="text-lg font-semibold tracking-tight text-balance">Shorten your first link</h2>
      <p className="mt-1.5 text-sm text-pretty text-muted">Its clicks and QR code show up here.</p>
      <Button variant="primary" className="mt-6" onClick={onCreate}>
        <IconPlus size={15} aria-hidden /> Create link
      </Button>
    </section>
  );
}

function RecentClicks({ clicks }: { clicks: RecentClick[] }) {
  if (!clicks.length)
    return (
      <p className="py-2 text-sm text-pretty text-muted">Each click shows here as it happens.</p>
    );
  return (
    <ul className="flex flex-col">
      {clicks.map((click) => {
        const place =
          click.country && click.country !== "unknown" ? countryName(click.country) : "";
        return (
          <li
            key={click.id}
            className="grid h-8 grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto_1.75rem] items-center gap-2.5 text-sm [&+&]:shadow-[inset_0_1px_0_var(--border)]"
          >
            <HrefLink
              href={linkPagePath(click)}
              className="truncate font-mono text-[13px] [@media(hover:hover)]:hover:underline"
            >
              /{click.slug}
            </HrefLink>
            <span className="truncate text-muted">{sourceLabel(click.referrer || "direct")}</span>
            <Tooltip content={place || "Unknown country"}>
              <span className="flex">
                <Flag code={click.country || "unknown"} />
                <span className="sr-only">{place || "Unknown country"}</span>
              </span>
            </Tooltip>
            <Tooltip content={`${shortDate(click.ts)}, ${relativeDate(click.ts)}`}>
              <time
                dateTime={new Date(click.ts).toISOString()}
                className="tnum text-right text-xs text-muted"
              >
                {shortAgo(click.ts)}
              </time>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

function TeamActivity({
  links,
  creatorName,
}: {
  links: LinkDTO[];
  creatorName: (id: string | null) => string;
}) {
  if (!links.length)
    return (
      <p className="py-2 text-sm text-pretty text-muted">
        New links show here, with who made them.
      </p>
    );
  return (
    <ul className="flex flex-col">
      {links.map((l) => (
        <li
          key={l.id}
          className="flex h-8 items-center justify-between gap-3 text-sm [&+&]:shadow-[inset_0_1px_0_var(--border)]"
        >
          <span className="min-w-0 truncate">
            <span className="font-medium">{creatorName(l.createdBy)}</span>
            <span className="text-muted"> created </span>
            <HrefLink
              href={linkPagePath(l)}
              className="font-mono text-[13px] [@media(hover:hover)]:hover:underline"
            >
              /{l.slug}
            </HrefLink>
          </span>
          <Tooltip content={shortDate(l.createdAt)}>
            <span className="tnum shrink-0 text-xs text-muted">{shortAgo(l.createdAt)}</span>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

/** Links whose clicks fell by half this week, then links nobody clicked in
 * 30 days. */
function AttentionList({ rows }: { rows: (StatsLinkRef & { suffix: string })[] }) {
  if (!rows.length)
    return (
      <p className="py-2 text-sm text-pretty text-muted">
        No link lost half its clicks or went quiet.
      </p>
    );
  return (
    <ul className="flex flex-col">
      {rows.map((l) => (
        <li
          key={l.id}
          className="flex h-8 items-center justify-between gap-3 text-sm [&+&]:shadow-[inset_0_1px_0_var(--border)]"
        >
          <SlugLink to={linkPagePath(l)} slug={l.slug} title={l.title} />
          <span className="tnum shrink-0 text-xs text-muted">{l.suffix}</span>
        </li>
      ))}
    </ul>
  );
}
