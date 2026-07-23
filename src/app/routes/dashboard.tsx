import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "react-router";
import { useStats, useLinks, useMembers, useLinkMutations, useRecentClicks } from "../lib/hooks";
import { useOrgLimits } from "../lib/org-limits";
import { shortUrl } from "../lib/api";
import { type DomainDTO, type LinkDTO, type RecentClick } from "@/shared/types";
import { BarList, StatCard } from "../components/charts";
import { DashboardSkeleton } from "../components/skeletons";
import { NoOrgState } from "../components/no-org";
import { QRPreview } from "../components/qr";
import type { OrgQr } from "../components/link-editor";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Card, PageHeader } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { CopyButton } from "../ui/copy-button";
import { withErrorToast } from "../lib/mutation-toast";
import { destinationSchema } from "../lib/schemas";
import { relativeDate } from "../lib/dates";
import { copyToClipboard } from "../lib/clipboard";

/** Heatmap rows come back Monday-first (see the stats query). */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const linkPath = (l: { slug: string; domain?: string | null }) =>
  l.domain ? `/links/${l.slug}?domain=${encodeURIComponent(l.domain)}` : `/links/${l.slug}`;

export function Dashboard() {
  const { org, orgId, limits, activeDomains, orgQr } = useOrgLimits();
  const stats = useStats(orgId);
  const links = useLinks(orgId);
  const members = useMembers(orgId);
  const clicks = useRecentClicks(orgId);
  const { create } = useLinkMutations(orgId);

  const [created, setCreated] = useState<LinkDTO | null>(null);

  const recentLinks = useMemo(
    () => [...(links.data ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
    [links.data],
  );
  // Link rows carry only the creator's user id; names come from the roster.
  const memberNames = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.userId, m.name])),
    [members.data],
  );
  const creatorName = (id: string | null) => (id && memberNames.get(id)) || "A former member";

  if (!org) return <NoOrgState />;
  if (stats.isLoading || links.isLoading || members.isLoading || clicks.isLoading)
    return <DashboardSkeleton />;
  if (!stats.data) return <p className="text-sm text-danger">Could not load stats.</p>;
  const s = stats.data;

  const decaying = s.decayingLinks.slice(0, 3);
  const dead = s.deadLinks.slice(0, 3);
  const peakCell = s.heatmap.length
    ? s.heatmap.reduce((max, cell) => (cell.clicks > max.clicks ? cell : max))
    : null;
  const peak = peakCell && peakCell.clicks > 0 ? peakCell : null;

  return (
    <div>
      <PageHeader title="Dashboard" sub="See your organization's link activity at a glance" />

      <QuickCreateCard
        create={create}
        activeDomains={activeDomains}
        atLimit={s.totalLinks >= limits.links}
        onCreated={setCreated}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Links" value={s.totalLinks} />
        <StatCard label="Clicks · 7d" value={s.clicks7d} delta={s.clicks7dDelta} />
        <StatCard label="Members" value={members.data?.length ?? 0} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentClicksCard clicks={clicks.data ?? []} />
        <ActivityCard links={recentLinks} creatorName={creatorName} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TopLinksCard topLinks={s.topLinks} />
        <NeedsAttentionCard decaying={decaying} dead={dead} />
        <PeakCard peak={peak} rangeDays={s.rangeDays} />
      </div>

      <CreatedDialog
        link={created}
        onClose={() => setCreated(null)}
        qrEnabled={limits.qr}
        orgQr={orgQr}
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
}: {
  create: ReturnType<typeof useLinkMutations>["create"];
  activeDomains: DomainDTO[];
  atLimit: boolean;
  onCreated: (link: LinkDTO) => void;
}) {
  const toast = useToast();
  const [domainId, setDomainId] = useState<string | null>(null);

  const { register, handleSubmit, reset, watch } = useForm({
    resolver: zodResolver(destinationSchema),
    defaultValues: { destination: "" },
  });

  const destination = watch("destination");

  const submit = handleSubmit(
    (data) => {
      if (create.isPending) return;
      create.mutate(
        { destination: data.destination.trim(), domainId },
        {
          onSuccess: (link) => {
            reset({ destination: "" });
            onCreated(link);
          },
          onError: withErrorToast(toast),
        },
      );
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
        {activeDomains.length > 0 && (
          <div className="sm:w-56">
            <MenuSelect
              label="Domain"
              value={domainId ?? ""}
              onChange={(v) => setDomainId(v || null)}
              options={[
                { value: "", label: `shared: ${window.location.host}` },
                ...activeDomains.map((d) => ({
                  value: d.id,
                  label: d.hostname,
                })),
              ]}
            />
          </div>
        )}
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

function TopLinksCard({
  topLinks,
}: {
  topLinks: { id: string; slug: string; title: string; clicks: number }[];
}) {
  return (
    <Card>
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Top links</p>
      {topLinks.length ? (
        <BarList
          items={topLinks.slice(0, 5).map((l) => ({
            key: `/${l.slug}${l.title ? ` · ${l.title}` : ""}`,
            clicks: l.clicks,
          }))}
        />
      ) : (
        <p className="py-4 text-sm text-muted">No data yet</p>
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
  return (
    <Card>
      <p className="mb-3 text-2xs tracking-wider text-muted uppercase">Needs attention</p>
      {!decaying.length && !dead.length ? (
        <p className="py-2 text-sm text-muted">No decaying or dead links</p>
      ) : (
        <div className="flex flex-col gap-3">
          {decaying.length > 0 && (
            <AttentionList
              label="Decaying"
              rows={decaying.map((l) => ({ ...l, suffix: `${l.drop}% drop` }))}
            />
          )}
          {dead.length > 0 && (
            <AttentionList
              label="Dead"
              rows={dead.map((l) => ({ ...l, suffix: "0 clicks in 30d" }))}
            />
          )}
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
            <Link to={`/links/${l.slug}`} className="truncate text-accent hover:underline">
              /{l.slug}
              {l.title ? ` · ${l.title}` : ""}
            </Link>
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

/** Shown right after a quick create: the short URL, its QR code when the
 * plan includes QR codes, and a copy button. */
function CreatedDialog({
  link,
  onClose,
  qrEnabled,
  orgQr,
}: {
  link: LinkDTO | null;
  onClose: () => void;
  qrEnabled: boolean;
  orgQr: OrgQr;
}) {
  const toast = useToast();
  const url = link ? shortUrl(link.slug, link.domain) : "";

  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()} title="Link created">
      {link && (
        <div className="flex flex-col items-center gap-3">
          {qrEnabled && (
            <QRPreview
              url={url}
              logo={orgQr.logo || undefined}
              dotStyle={orgQr.style}
              color={orgQr.color}
              corner={orgQr.corner}
              eyeColor={orgQr.eyeColor}
              bg={orgQr.bg}
              logoSize={orgQr.logoSize ?? undefined}
              downloadName={`qr-${link.slug}`}
            />
          )}
          <p className="text-sm font-bold break-all">{url}</p>
          <CopyButton
            text={url}
            label="Copy link"
            onCopy={(text) => copyToClipboard(text, toast)}
            display="button"
          >
            Copy link
          </CopyButton>
        </div>
      )}
    </Dialog>
  );
}
