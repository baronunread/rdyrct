import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { dashboardView } from "./dashboard-view";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { HrefLink } from "../lib/router-search";
import {
  useStats,
  useLinks,
  useMembers,
  useLinkMutations,
  useRecentClicks,
  useLinkHost,
  useClickUsage,
} from "../lib/hooks";
import { useOrgLimits } from "../lib/org-limits";
import { ApiError } from "../lib/api";
import { type DomainDTO, type LinkDTO, type LinkInput, type RecentClick } from "@/shared/types";
import { AreaChart, BarList, StatsChart, dayTick } from "../components/charts";
import { useNewLink, NewLinkButton } from "../components/new-link-host";
import { PanelTabs } from "../ui/tabs";
import { formatNumber } from "../lib/numbers";
import { DashboardSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { ClickCapBanner } from "../components/over-limit";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Card, PageHeader, SlugLink } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { withErrorToast } from "../lib/mutation-toast";
import { destinationSchema } from "../lib/schemas";
import { relativeDate } from "../lib/dates";
import { SameDestinationDialog } from "../components/same-destination-dialog";
import { LinkPreviewDialog } from "../components/link-preview-dialog";

const linkPath = (l: { slug: string; domain?: string | null }) =>
  l.domain ? `/links/${l.slug}?domain=${encodeURIComponent(l.domain)}` : `/links/${l.slug}`;

/** Link rows carry only the creator's user id; names come from the roster. */
function creatorNameFrom(memberNames: Map<string, string>, id: string | null): string {
  return (id && memberNames.get(id)) || "A former member";
}

/** Loads and shapes every data source the dashboard renders from. */
function useDashboardData(orgId: string) {
  const stats = useStats(orgId);
  // Five, from the server, rather than every link the org owns sorted in the
  // browser: this card only ever showed the newest handful.
  const links = useLinks(orgId, { limit: 5 });
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
    recentLinks,
    creatorName: (id: string | null) => creatorNameFrom(memberNames, id),
    clicks: clicks.data ?? [],
    memberCount: members.data?.length ?? 0,
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

/** The page asks one question until there is a link, then goes back to being
 * a dashboard. */
const FIRST_RUN_HEADER = {
  title: "Shorten your first link",
  sub: "Paste any long URL. Your stats appear here once it starts getting clicks.",
};
const DASHBOARD_HEADER = { title: "Dashboard" };

/**
 * The dashboard once there is something to count: this week's clicks over
 * the chart, then two panels (rdyrct-design, "Panels hold lists behind
 * tabs"). The full report is Analytics.
 */
function DashboardBody({
  stats: s,
  data,
}: {
  stats: NonNullable<DashboardData["stats"]>;
  data: DashboardData;
}) {
  const attention = [
    ...s.decayingLinks.map((l) => ({ ...l, suffix: `${l.drop}% fewer clicks` })),
    ...s.deadLinks.map((l) => ({ ...l, suffix: "No clicks in 30 days" })),
  ];
  return (
    <div className="flex flex-col gap-6">
      <StatsChart
        figures={[
          { label: "Clicks · 7d", value: formatNumber(s.clicks7d), delta: s.clicks7dDelta },
          { label: "Links", value: formatNumber(s.totalLinks) },
          { label: "Members", value: formatNumber(data.memberCount) },
        ]}
      >
        {s.bucket === "day" && <AreaChart data={s.series.slice(-7)} tickFormat={dayTick} />}
      </StatsChart>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PanelTabs
          end={
            <HrefLink href="/analytics" className="hover:text-text">
              Analytics
            </HrefLink>
          }
          tabs={[
            {
              value: "top",
              label: "Top links",
              panel: (
                <BarList
                  head={["Link", "Clicks"]}
                  empty="Your busiest links appear here once they start collecting clicks."
                  items={s.topLinks.slice(0, 6).map((l) => ({ key: l.slug, clicks: l.clicks }))}
                  formatKey={(slug) => topLinkLabel(s.topLinks, slug)}
                />
              ),
            },
            {
              value: "attention",
              label: (
                <>
                  Needs attention
                  {attention.length > 0 && (
                    <span className="tnum ml-1.5 font-normal text-muted">{attention.length}</span>
                  )}
                </>
              ),
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
    </div>
  );
}

/** A top link's row label: its title, else its slug. */
function topLinkLabel(links: { slug: string; title: string }[], slug: string) {
  const link = links.find((l) => l.slug === slug);
  return (
    <HrefLink href={`/links/${slug}`} className="hover:underline">
      {link?.title || `/${slug}`}
    </HrefLink>
  );
}

/** Nothing to show until there is an organization and its numbers have
 * arrived. Separated from the page itself so the page is about the page. */
export function Dashboard() {
  const { org, orgId, currentUser } = useOrgLimits();
  const data = useDashboardData(orgId);
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
      // SAFETY: dashboardView only returns "ready" once hasStats (!!data.stats) is true.
      return <DashboardScreen stats={data.stats!} />;
  }
}

function DashboardScreen({ stats: s }: { stats: NonNullable<DashboardData["stats"]> }) {
  const { orgId, limits, activeDomains, defaultDomainId, orgQr } = useOrgLimits();
  const data = useDashboardData(orgId);
  const { openNewLink, canCreate } = useNewLink();
  const toast = useToast();
  const [created, setCreated] = useState<LinkDTO | null>(null);
  const [sameDestination, setSameDestination] = useState<{
    input: LinkInput;
    matchedLinks: LinkDTO[];
  } | null>(null);

  // First run. An organization exists from the first session, so what is
  // missing is the link, and the field that makes one is already the first
  // thing on this page. Showing the rest (three zeroes, four empty cards, a
  // flat chart) would teach somebody that the product is empty; hiding it
  // until there is something to count leaves one question on screen.
  const firstRun = s.totalLinks === 0;

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
      {firstRun ? (
        <PageHeader {...FIRST_RUN_HEADER} />
      ) : (
        <PageHeader
          {...DASHBOARD_HEADER}
          action={canCreate && <NewLinkButton onClick={openNewLink} />}
        />
      )}

      <ClickCapBanner />

      {/* The field only asks for the first link. After that, New link opens
          the same dialog everywhere (header, C, ⌘K). */}
      {firstRun ? (
        <QuickCreateCard
          create={data.create}
          activeDomains={activeDomains}
          defaultDomainId={defaultDomainId}
          atLimit={s.totalLinks >= limits.links}
          onCreated={setCreated}
          onSameDestinationMatch={(input, matchedLinks) =>
            setSameDestination({ input, matchedLinks })
          }
        />
      ) : (
        <DashboardBody stats={s} data={data} />
      )}

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
    <div className="sm:w-56">
      <MenuSelect
        label="Domain"
        className="h-11 text-base sm:h-9 sm:text-sm"
        value={domainId ?? ""}
        onChange={(v) => onChange(v || null)}
        options={[
          { value: "", label: `shared: ${linkHost}` },
          ...activeDomains.map((d) => ({ value: d.id, label: d.hostname })),
        ]}
      />
    </div>
  );
}

/** The no-fuss link creator: paste a URL, pick a domain, done. */
function QuickCreateCard({
  create,
  activeDomains,
  defaultDomainId,
  atLimit,
  onCreated,
  onSameDestinationMatch,
}: {
  create: ReturnType<typeof useLinkMutations>["create"];
  activeDomains: DomainDTO[];
  /** The org's default domain (#69), already checked against activeDomains. */
  defaultDomainId: string | null;
  atLimit: boolean;
  onCreated: (link: LinkDTO) => void;
  onSameDestinationMatch: (input: LinkInput, matchedLinks: LinkDTO[]) => void;
}) {
  const toast = useToast();
  // undefined means "not chosen yet", which is not the same as choosing the
  // shared domain: until someone picks, the card follows the org default,
  // including when the domains query answers after this first render.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const domainId = picked === undefined ? defaultDomainId : picked;

  const { register, handleSubmit, reset, watch, getValues, setValue, setFocus } = useForm({
    resolver: valibotResolver(destinationSchema),
    defaultValues: { destination: "" },
  });

  const destination = watch("destination");

  // Type or paste anywhere on the dashboard and it lands in this field:
  // this screen has one job, so a keystroke is enough to start it.
  useEffect(() => {
    const busyElsewhere = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement)) return false;
      return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    };
    const fill = (value: string) => {
      setValue("destination", value, { shouldValidate: true });
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
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("paste", onPaste);
    };
  }, [getValues, setFocus, setValue]);

  const submit = handleSubmit(
    (data) => {
      if (create.isPending) return;
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
          withErrorToast(toast)(e);
        },
      });
    },
    () => toast("Enter a valid URL", "error"),
  );

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          {...register("destination")}
          className="h-11 min-w-0 flex-1 text-base sm:h-9 sm:text-sm"
          placeholder="https://example.com/launch"
          aria-label="Destination URL"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <QuickCreateDomainSelect
          activeDomains={activeDomains}
          domainId={domainId}
          onChange={setPicked}
        />
        <Button
          variant="primary"
          type="submit"
          disabled={!destination?.trim() || atLimit}
          title={atLimit ? "Link limit reached: upgrade for more links" : undefined}
        >
          <BusyContent busy={create.isPending}>Create link</BusyContent>
        </Button>
      </form>
    </Card>
  );
}

function RecentClicks({ clicks }: { clicks: RecentClick[] }) {
  if (!clicks.length)
    return (
      <p className="py-2 text-sm text-pretty text-muted">Each click shows here as it happens.</p>
    );
  return (
    <ul className="flex flex-col">
      {clicks.map((click) => (
        <li
          key={click.id}
          className="grid h-9 grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm"
        >
          <HrefLink href={linkPath(click)} className="truncate font-mono text-xs hover:underline">
            /{click.slug}
          </HrefLink>
          <span className="truncate text-muted">{click.referrer || "Direct"}</span>
          <span className="tnum text-right text-xs text-muted">
            {[click.country, relativeDate(click.ts)].filter(Boolean).join(" · ")}
          </span>
        </li>
      ))}
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
        <li key={l.id} className="flex h-9 items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">
            <span className="font-medium">{creatorName(l.createdBy)}</span>
            <span className="text-muted"> created </span>
            <HrefLink href={linkPath(l)} className="font-mono text-xs hover:underline">
              /{l.slug}
            </HrefLink>
          </span>
          <span className="shrink-0 text-xs text-muted">{relativeDate(l.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Links whose clicks fell by half this week, then links nobody clicked in
 * 30 days. */
function AttentionList({
  rows,
}: {
  rows: { id: string; slug: string; title: string; suffix: string }[];
}) {
  if (!rows.length)
    return (
      <p className="py-2 text-sm text-pretty text-muted">
        No link lost half its clicks or went quiet.
      </p>
    );
  return (
    <ul className="flex flex-col">
      {rows.map((l) => (
        <li key={l.id} className="flex h-9 items-center justify-between gap-3 text-sm">
          <SlugLink to={`/links/${l.slug}`} slug={l.slug} title={l.title} />
          <span className="tnum shrink-0 text-xs text-muted">{l.suffix}</span>
        </li>
      ))}
    </ul>
  );
}
