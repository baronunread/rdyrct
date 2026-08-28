import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { dashboardView } from "./dashboard-view";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { HrefLink } from "../lib/router-search";
import { useStats, useLinks, useMembers, useLinkMutations, useRecentClicks } from "../lib/hooks";
import { useOrgLimits } from "../lib/org-limits";
import { ApiError } from "../lib/api";
import { type DomainDTO, type LinkDTO, type LinkInput, type RecentClick } from "@/shared/types";
import { StatCard, TopLinksCard } from "../components/charts";
import { DashboardSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
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

/** Heatmap rows come back Monday-first (see the stats query). */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

/** The busiest heatmap cell, or null when there's no activity to report. */
function peakActivityCell(
  heatmap: { dayOfWeek: number; hour: number; clicks: number }[],
): { dayOfWeek: number; hour: number; clicks: number } | null {
  if (!heatmap.length) return null;
  const peakCell = heatmap.reduce((max, cell) => (cell.clicks > max.clicks ? cell : max));
  return peakCell.clicks > 0 ? peakCell : null;
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
const DASHBOARD_HEADER = {
  title: "Dashboard",
  sub: "See your organization's link activity at a glance",
};

/**
 * Everything below the create field: the numbers, and the cards that read
 * them. Split out because it only renders once there is something to count,
 * so the page itself is the question plus this.
 */
function DashboardBody({
  stats: s,
  data,
}: {
  stats: NonNullable<DashboardData["stats"]>;
  data: DashboardData;
}) {
  const peak = peakActivityCell(s.heatmap);
  return (
    <>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Links" value={s.totalLinks} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} delta={s.clicks7dDelta} />
        <StatCard label="Members" value={data.memberCount} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentClicksCard clicks={data.clicks} />
        <ActivityCard links={data.recentLinks} creatorName={data.creatorName} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TopLinksCard topLinks={s.topLinks} limit={5} />
        <NeedsAttentionCard decaying={s.decayingLinks.slice(0, 3)} dead={s.deadLinks.slice(0, 3)} />
        <PeakCard peak={peak} rangeDays={s.rangeDays} />
      </div>
    </>
  );
}

/** Nothing to show until there is an organization and its numbers have
 * arrived. Separated from the page itself so the page is about the page. */
export function Dashboard() {
  const { org, orgId, currentUser } = useOrgLimits();
  const data = useDashboardData(orgId);
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
      <PageHeader {...(firstRun ? FIRST_RUN_HEADER : DASHBOARD_HEADER)} />

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

      {!firstRun && <DashboardBody stats={s} data={data} />}

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
  if (!activeDomains.length) return null;
  return (
    <div className="sm:w-56">
      <MenuSelect
        label="Domain"
        value={domainId ?? ""}
        onChange={(v) => onChange(v || null)}
        options={[
          { value: "", label: `shared: ${window.location.host}` },
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
      <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <Input
            {...register("destination")}
            placeholder="https://example.com/launch"
            aria-label="Destination URL"
          />
          <p className="mt-1 text-xs text-muted">Paste or start typing anywhere on the page.</p>
        </div>
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

function RecentClicksCard({ clicks }: { clicks: RecentClick[] }) {
  return (
    <Card>
      <p className="mb-3 text-xs font-medium text-muted">Recent clicks</p>
      {!clicks.length ? (
        <p className="py-2 text-sm text-muted">No clicks yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clicks.map((click) => (
            <li key={click.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate">
                <HrefLink href={linkPath(click)} className="text-accent hover:underline">
                  /{click.slug}
                </HrefLink>
                <span className="text-muted"> · {click.referrer || "direct"}</span>
              </span>
              <span className="tnum shrink-0 text-muted">
                {[click.country, click.device, relativeDate(click.ts)].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityCard({
  links,
  creatorName,
}: {
  links: LinkDTO[];
  creatorName: (id: string | null) => string;
}) {
  return (
    <Card>
      <p className="mb-3 text-xs font-medium text-muted">Member activity</p>
      {!links.length ? (
        <p className="py-2 text-sm text-muted">No activity yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate">
                <span className="font-bold">{creatorName(l.createdBy)}</span>
                {" created "}
                <HrefLink href={linkPath(l)} className="text-accent hover:underline">
                  /{l.slug}
                </HrefLink>
              </span>
              <span className="shrink-0 text-muted">{relativeDate(l.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NeedsAttentionCard({
  decaying,
  dead,
}: {
  decaying: { id: string; slug: string; title: string; drop: number }[];
  dead: { id: string; slug: string; title: string }[];
}) {
  const groups = [
    { label: "Decaying", rows: decaying.map((l) => ({ ...l, suffix: `${l.drop}% drop` })) },
    { label: "Dead", rows: dead.map((l) => ({ ...l, suffix: "0 clicks in 30d" })) },
  ].filter((g) => g.rows.length > 0);

  return (
    <Card>
      <p className="mb-3 text-xs font-medium text-muted">Needs attention</p>
      {!groups.length ? (
        <p className="py-2 text-sm text-muted">No decaying or dead links</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <AttentionList key={g.label} label={g.label} rows={g.rows} />
          ))}
        </div>
      )}
    </Card>
  );
}

/** One labeled group inside the Needs attention card. */
function AttentionList({
  label,
  rows,
}: {
  label: string;
  rows: { id: string; slug: string; title: string; suffix: string }[];
}) {
  return (
    <div>
      <p className="mb-1.5 text-2xs text-muted">{label}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 text-xs">
            <SlugLink to={`/links/${l.slug}`} slug={l.slug} title={l.title} />
            <span className="tnum shrink-0 text-muted">{l.suffix}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PeakCard({
  peak,
  rangeDays,
}: {
  peak: { dayOfWeek: number; hour: number } | null;
  rangeDays: number;
}) {
  return (
    <Card>
      <p className="mb-3 text-xs font-medium text-muted">Peak activity</p>
      {!peak ? (
        <p className="py-2 text-sm text-muted">No clicks yet</p>
      ) : (
        <>
          <p className="tnum text-sm font-bold">
            {WEEKDAYS[peak.dayOfWeek]} · {peak.hour}:00–{peak.hour + 1}:00
          </p>
          <p className="mt-1 text-xs text-muted">Busiest hour over the last {rangeDays} days</p>
        </>
      )}
    </Card>
  );
}
