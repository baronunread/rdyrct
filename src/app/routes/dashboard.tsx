import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { IconLink, IconPlus } from "@tabler/icons-react";
import { dashboardView } from "./dashboard-view";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { HrefLink } from "../lib/router-search";
import type { QueryClient } from "@tanstack/react-query";
import {
  useLinks,
  useMembers,
  useLinkMutations,
  useRecentClicks,
  useLinkHost,
  useClickUsage,
  linksQuery,
  membersQuery,
  recentClicksQuery,
  clickUsageQuery,
  linkQuotaUsageQuery,
} from "../lib/hooks";
import { preloadOrgDomains, useOrgLimits } from "../lib/org-limits";
import { settle, type PageContext } from "../lib/route-preload";
import { ApiError } from "../lib/api";
import {
  type DomainDTO,
  type LinkDTO,
  type LinkInput,
  type OrgStats,
  type RecentClick,
  type StatsLinkRef,
} from "@/shared/types";
import { AreaChart, BarList, LinkBarLabel, StatsChart } from "../components/charts";
import { countryName } from "../lib/places";
import { linkPagePath } from "../lib/link-display";
import { displayHost } from "../lib/display-url";
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
import { Input } from "../ui/field";
import { Kbd } from "../ui/kbd";
import { MenuSelect } from "../ui/menu";
import { PageHeader, SlugLink } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { Tooltip } from "../ui/tooltip";
import { useToast } from "../ui/toast";
import { withErrorToast } from "../lib/mutation-toast";
import { destinationSchema } from "../lib/schemas";
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
import { SameDestinationDialog } from "../components/same-destination-dialog";
import { LinkPreviewDialog } from "../components/link-preview-dialog";
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
  const { create } = useLinkMutations(orgId);

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
    create,
  };
}

/** Shared shape of the same-destination dialog's two "go ahead" actions:
 * differ only in which extra field they send. */
function submitSameDestination(
  create: ReturnType<typeof useLinkMutations>["create"],
  input: LinkInput,
  extra: Partial<LinkInput>,
  onDone: (link: LinkDTO) => void,
  onError: (e: Error) => void,
) {
  create.mutate({ ...input, ...extra }, { onSuccess: onDone, onError });
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
  const { org, limits, activeDomains, defaultDomainId, orgQr, canWrite } = useOrgLimits();
  const { openNewLink, canCreate } = useNewLink();
  const toast = useToast();
  const [created, setCreated] = useState<LinkDTO | null>(null);
  const [sameDestination, setSameDestination] = useState<{
    input: LinkInput;
    matchedLinks: LinkDTO[];
  } | null>(null);

  // First run. An organization exists from the first session, so what is
  // missing is the link. The page keeps its header, the way Resend, Linear
  // and Stripe keep theirs, and one plain panel takes the place of the cards
  // with the field that makes it: three zeroes, four empty cards and a flat
  // chart would teach somebody the product is empty. Only for somebody who
  // can make that link: a read-only org or a viewer gets the dashboard as it
  // is.
  const firstRun = useHeldFirstRun(
    s.totalLinks === 0 && canWrite,
    created !== null || sameDestination !== null || data.create.isPending,
  );

  /** Both answers to "this destination already has a link" submit the same
   * input with one extra field, and land on the same created-link dialog. */
  const resolveMatch = (extra: { mergeIntoLinkId?: string; forceSeparateLink?: boolean }) => {
    if (!sameDestination) return;
    submitSameDestination(
      data.create,
      sameDestination.input,
      extra,
      (link) => {
        setSameDestination(null);
        setCreated(link);
      },
      withErrorToast(toast),
    );
  };

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

      {/* The field only asks for the first link. After that, New link opens
          the same dialog everywhere (header, C, ⌘K). */}
      <DashboardMain
        firstRun={firstRun}
        stats={s}
        data={data}
        days={range.days}
        quickCreate={{
          create: data.create,
          activeDomains,
          defaultDomainId,
          atLimit: s.totalLinks >= limits.links,
          onCreated: setCreated,
          onSameDestinationMatch: (input, matchedLinks) =>
            setSameDestination({ input, matchedLinks }),
        }}
      />

      <LinkPreviewDialog
        title="Link created"
        link={created}
        onClose={() => setCreated(null)}
        orgQr={orgQr}
      />

      <SameDestinationDialog
        matchedLinks={sameDestination?.matchedLinks ?? null}
        pending={data.create.isPending}
        onClose={() => setSameDestination(null)}
        onAddToExisting={(matchedLink) => resolveMatch({ mergeIntoLinkId: matchedLink.id })}
        onCreateSeparate={() => resolveMatch({ forceSeparateLink: true })}
      />
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

/** Under the header: the first-link screen for somebody who can write to an
 * empty org, the dashboard otherwise. */
function DashboardMain({
  firstRun,
  stats,
  data,
  days,
  quickCreate,
}: {
  firstRun: boolean;
  stats: NonNullable<DashboardData["stats"]>;
  data: DashboardData;
  /** The range the insights row compares over. */
  days: number;
  quickCreate: QuickCreateProps;
}) {
  if (firstRun) return <FirstRun {...quickCreate} />;
  return (
    <div data-setup-body>
      <DashboardBody stats={stats} data={data} days={days} />
    </div>
  );
}

/** A new account's dashboard under its header: one plain panel with a
 * title, one line and the field, the way an empty page looks in Resend or
 * Stripe. No feature list, no stand-in rows: the field is the point. */
function FirstRun(form: QuickCreateProps) {
  return (
    <section className="flex flex-col items-center rounded-xl bg-surface px-5 py-12 text-center smooth-shadow-ring-xs sm:py-20">
      <h2 className="text-lg font-semibold tracking-tight text-balance">Shorten your first link</h2>
      <p className="mt-1.5 text-sm text-pretty text-muted">
        Paste a long URL. Its clicks and QR code show up here.
      </p>
      <div className="mt-6 w-full max-w-[560px] text-left">
        <QuickCreateCard {...form} />
      </div>
    </section>
  );
}

function QuickCreateDomainSelect({
  activeDomains,
  domainId,
  onChange,
}: {
  activeDomains: DomainDTO[];
  domainId: string | null;
  onChange: (id: string | null) => void;
}) {
  const linkHost = useLinkHost();
  if (!activeDomains.length) return null;
  return (
    <div className="sm:w-48">
      <MenuSelect
        label="Domain"
        className="h-12 text-base sm:text-sm"
        value={domainId ?? ""}
        onChange={(v) => onChange(v || null)}
        options={[
          { value: "", label: linkHost },
          ...activeDomains.map((d) => ({ value: d.id, label: displayHost(d.hostname) })),
        ]}
      />
    </div>
  );
}

interface QuickCreateProps {
  create: ReturnType<typeof useLinkMutations>["create"];
  activeDomains: DomainDTO[];
  /** The org's default domain (#69), already checked against activeDomains. */
  defaultDomainId: string | null;
  atLimit: boolean;
  onCreated: (link: LinkDTO) => void;
  onSameDestinationMatch: (input: LinkInput, matchedLinks: LinkDTO[]) => void;
}

/** A field reason short enough for the field itself. */
const fieldReason = (message: string) => (message.length <= 32 ? message : "Check this URL");

/** The no-fuss link creator: paste a URL, pick a domain, done. */
function QuickCreateCard({
  create,
  activeDomains,
  defaultDomainId,
  atLimit,
  onCreated,
  onSameDestinationMatch,
}: QuickCreateProps) {
  const toast = useToast();
  // undefined means "not chosen yet", which is not the same as choosing the
  // shared domain: until someone picks, the card follows the org default,
  // including when the domains query answers after this first render.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const domainId = picked === undefined ? defaultDomainId : picked;

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    setFocus,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm({
    resolver: valibotResolver(destinationSchema),
    defaultValues: { destination: "" },
  });
  const error = errors.destination?.message;

  // Type or paste anywhere on the dashboard and it lands in this field:
  // this screen has one job, so a keystroke is enough to start it.
  useEffect(() => {
    const busyElsewhere = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    };
    const fill = (value: string) => {
      setValue("destination", value);
      clearErrors("destination");
      setFocus("destination");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || busyElsewhere()) return;
      // The browser won't route this keystroke to an input we focus mid-event,
      // so append it by hand. busyElsewhere() already excluded the field
      // itself, so there's no double-insert.
      e.preventDefault();
      fill((getValues("destination") ?? "") + e.key);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (busyElsewhere()) return;
      const text = e.clipboardData?.getData("text")?.trim();
      if (!text) return;
      e.preventDefault();
      fill(text);
    };
    // Capture phase, so this claims the key before the shell's G chords
    // (go-shortcuts.ts) see it: they skip a key somebody already took.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("paste", onPaste);
    };
  }, [getValues, setFocus, setValue, clearErrors]);

  // Validated on submit: the button stays live and a bad URL marks the
  // field, with the reason inside it, rather than a toast.
  const submit = handleSubmit(
    (data) => {
      if (create.isPending) return;
      if (atLimit) {
        toast("Link limit reached: delete a link or upgrade for more", "error");
        return;
      }
      const input: LinkInput = { destination: data.destination.trim(), domainId };
      create.mutate(input, {
        onSuccess: (link) => {
          reset({ destination: "" });
          onCreated(link);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === "same_destination_match") {
            // SAFETY: guarded by the same_destination_match code above, and
            // the route that sets that code attaches matchedLinks with it.
            const { matchedLinks } = e.data as { matchedLinks: LinkDTO[] };
            onSameDestinationMatch(input, matchedLinks);
            return;
          }
          // A destination the server refuses is this field's problem.
          if (e instanceof ApiError && e.status === 400) {
            setError("destination", { message: e.message }, { shouldFocus: true });
            return;
          }
          withErrorToast(toast)(e);
        },
      });
    },
    () => setFocus("destination"),
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <IconLink
          aria-hidden
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-placeholder"
        />
        <Input
          {...register("destination", { onChange: () => clearErrors("destination") })}
          className="h-12 pl-9 text-base shadow-none sm:text-[15px]"
          placeholder="https://example.com/launch"
          aria-label="Destination URL"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "first-link-error" : undefined}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          style={error ? { paddingRight: "9rem" } : undefined}
        />
        {error && (
          <span
            id="first-link-error"
            className="pointer-events-none absolute top-1/2 right-3 max-w-32 -translate-y-1/2 truncate text-xs text-danger"
          >
            {fieldReason(error)}
          </span>
        )}
      </div>
      <QuickCreateDomainSelect
        activeDomains={activeDomains}
        domainId={domainId}
        onChange={setPicked}
      />
      <Button variant="primary" type="submit" className="h-12 px-5">
        <BusyContent busy={create.isPending}>Create link</BusyContent>
      </Button>
    </form>
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
