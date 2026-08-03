import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { Link } from "react-router";
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
  const links = useLinks(orgId);
  const members = useMembers(orgId);
  const clicks = useRecentClicks(orgId);
  const { create } = useLinkMutations(orgId);

  const recentLinks = useMemo(
    () => [...(links.data ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [links.data],
  );
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

export function Dashboard() {
  const { org, orgId, limits, activeDomains, orgQr } = useOrgLimits();
  const data = useDashboardData(orgId);
  const toast = useToast();
  const [created, setCreated] = useState<LinkDTO | null>(null);
  const [sameDestination, setSameDestination] = useState<{
    input: LinkInput;
    matchedLinks: LinkDTO[];
  } | null>(null);

  if (!org) return <NoOrgState />;
  if (data.isLoading) return <DashboardSkeleton />;
  if (!data.stats) return <p className="text-sm text-danger">Could not load stats.</p>;
  const s = data.stats;

  const decaying = s.decayingLinks.slice(0, 3);
  const dead = s.deadLinks.slice(0, 3);
  const peak = peakActivityCell(s.heatmap);

  return (
    <div>
      <PageHeader title="Dashboard" sub="See your organization's link activity at a glance" />

      <QuickCreateCard
        create={data.create}
        activeDomains={activeDomains}
        atLimit={s.totalLinks >= limits.links}
        onCreated={setCreated}
        onSameDestinationMatch={(input, matchedLinks) =>
          setSameDestination({ input, matchedLinks })
        }
      />

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
        <NeedsAttentionCard decaying={decaying} dead={dead} />
        <PeakCard peak={peak} rangeDays={s.rangeDays} />
      </div>

      <LinkPreviewDialog
        title="Link created"
        link={created}
        onClose={() => setCreated(null)}
        qrEnabled={limits.qr}
        orgQr={orgQr}
      />

      <SameDestinationDialog
        matchedLinks={sameDestination?.matchedLinks ?? null}
        pending={data.create.isPending}
        onClose={() => setSameDestination(null)}
        onAddToExisting={(matchedLink) => {
          if (!sameDestination) return;
          const { input } = sameDestination;
          data.create.mutate(
            { ...input, mergeIntoLinkId: matchedLink.id },
            {
              onSuccess: (link) => {
                setSameDestination(null);
                setCreated(link);
              },
              onError: withErrorToast(toast),
            },
          );
        }}
        onCreateSeparate={() => {
          if (!sameDestination) return;
          const { input } = sameDestination;
          data.create.mutate(
            { ...input, forceSeparateLink: true },
            {
              onSuccess: (link) => {
                setSameDestination(null);
                setCreated(link);
              },
              onError: withErrorToast(toast),
            },
          );
        }}
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
  atLimit,
  onCreated,
  onSameDestinationMatch,
}: {
  create: ReturnType<typeof useLinkMutations>["create"];
  activeDomains: DomainDTO[];
  atLimit: boolean;
  onCreated: (link: LinkDTO) => void;
  onSameDestinationMatch: (input: LinkInput, matchedLinks: LinkDTO[]) => void;
}) {
  const toast = useToast();
  const [domainId, setDomainId] = useState<string | null>(null);

  const { register, handleSubmit, reset, watch } = useForm({
    resolver: valibotResolver(destinationSchema),
    defaultValues: { destination: "" },
  });

  const destination = watch("destination");

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
            autoFocus
          />
        </div>
        <QuickCreateDomainSelect
          activeDomains={activeDomains}
          domainId={domainId}
          onChange={setDomainId}
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
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Recent clicks</p>
      {!clicks.length ? (
        <p className="py-2 text-sm text-muted">No clicks yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clicks.map((click) => (
            <li key={click.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate">
                <Link to={linkPath(click)} className="text-accent hover:underline">
                  /{click.slug}
                </Link>
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
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Member activity</p>
      {!links.length ? (
        <p className="py-2 text-sm text-muted">No activity yet</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate">
                <span className="font-bold">{creatorName(l.createdBy)}</span>
                {" created "}
                <Link to={linkPath(l)} className="text-accent hover:underline">
                  /{l.slug}
                </Link>
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
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Needs attention</p>
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
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Peak activity</p>
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
