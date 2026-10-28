import { linkFieldError } from "../lib/link-field-errors";
import { useEffect, useMemo, useState } from "react";
import { morphKey, morphPart, setMorphLink } from "../lib/link-morph";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  IconDots,
  IconExternalLink,
  IconLinkPlus,
  IconQrcode,
  IconTrash,
} from "@tabler/icons-react";
import { useSearchParams } from "../lib/router-search";
import {
  addressesQuery,
  linksQuery,
  membersQuery,
  useLinks,
  useLinkMutations,
  useMembers,
} from "../lib/hooks";
import { preloadOrgDomains, useOrgLimits } from "../lib/org-limits";
import { settle, type PageContext } from "../lib/route-preload";
import { AreaChart, BarList, PlacesPanel, StatsChart, dayTick } from "../components/charts";
import { NoOrgState } from "../components/no-org";
import { LinkEditor } from "../components/link-editor";
import { LinkPreviewDialog } from "../components/link-preview-dialog";
import { linkFeatures } from "../components/new-link-host";
import { LinkDetailSide } from "../components/link-detail-side";
import { LinkDetailSkeleton } from "../components/skeletons";
import { RangeControl } from "../components/range-control";
import { SourceTile } from "../components/source-tile";
import { QRPreview } from "../components/qr";
import { CreateAliasDialog } from "../components/create-alias-dialog";
import { DeleteLinkDialog } from "../components/delete-link-dialog";
import { Badge } from "../ui/misc";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { Menu, MenuItem, MenuSeparator } from "../ui/menu";
import { PanelTabs } from "../ui/tabs";
import { cn } from "../ui/cn";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { formatNumber } from "../lib/numbers";
import { linkDisplayTitle } from "../lib/link-display";
import { resolveQrLook, type OrgQr } from "../lib/org-qr";
import {
  PRESET_30D,
  PRESET_365D,
  PRESET_7D,
  deviceLabel,
  sourceLabel,
  linkInsightStatsQuery,
  useLinkInsightStats,
  type RangePreset,
} from "../lib/insights-data";
import posthog from "../lib/posthog";
import { PLAN_LIMITS, type LinkDTO, type LinkInput, type LinkStats } from "@/shared/types";

const LINK_RANGES = [PRESET_7D, PRESET_30D, PRESET_365D] as const;

/** The list search that finds this link's row: there is no single-link read. */
const rowSearch = (slug: string) => ({ q: slug, limit: 100 });

/** Everything a link's first frame reads (see lib/route-preload.ts): its
 * stats, then the row and other addresses the stats name. */
export function preload(qc: QueryClient, orgId: string, page: PageContext) {
  const slug = page.params.slug ?? null;
  const domain = new URLSearchParams(page.searchStr).get("domain");
  const days = defaultRange(PLAN_LIMITS[page.org.plan].analyticsDays).days;
  const stats = qc
    .ensureQueryData(linkInsightStatsQuery(orgId, slug, domain, days))
    .then((s) =>
      settle([
        qc.ensureQueryData(linksQuery(orgId, rowSearch(s.slug))),
        qc.ensureQueryData(addressesQuery(orgId, s.id)),
      ]),
    );
  return settle([
    stats,
    qc.ensureQueryData(membersQuery(orgId)),
    preloadOrgDomains(qc, page.org, page.user),
  ]);
}

/**
 * The link as the links list knows it, for the editor and the QR dialog.
 * The stats answer carries no QR look, UTM tags or pause state, and there is
 * no single-link read, so this searches the list by slug and picks the row
 * by id. Null until it loads, or if the search somehow misses it: then the
 * page simply offers no Edit or QR code.
 */
function useLinkRow(orgId: string, s: LinkStats | undefined): LinkDTO | null {
  // An empty org id holds the query until the stats name the slug.
  const links = useLinks(s ? orgId : "", rowSearch(s?.slug ?? ""));
  if (!s) return null;
  return links.data?.items.find((l) => l.id === s.id) ?? null;
}

/** "go.example.com/" muted, then the slug: the part people read is the
 * part that differs between links. */
function ShortAddress({ url }: { url: string }) {
  const address = linkDisplayTitle(url);
  const cut = address.lastIndexOf("/") + 1;
  return (
    <span className="truncate font-mono text-sm" title={address}>
      <span className="text-muted">{address.slice(0, cut)}</span>
      {address.slice(cut)}
    </span>
  );
}

/** The link's own QR code, small, as the page's picture of it. Opens the
 * full-size code with its downloads. */
function QrThumb({
  url,
  link,
  orgQr,
  onOpen,
}: {
  url: string;
  link: LinkDTO | null;
  orgQr: OrgQr;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!link}
      aria-label="Show QR code"
      className="shrink-0 cursor-pointer rounded-xl transition-[scale] duration-200 ease-out active:scale-[0.97] disabled:cursor-default [&_[role=img]]:rounded-xl [&_[role=img]]:border-0 [&_[role=img]]:smooth-shadow-ring-xs"
    >
      <QRPreview url={url} size={56} {...resolveQrLook(link ?? {}, orgQr)} />
    </button>
  );
}

function LinkMenu({
  s,
  link,
  canWrite,
  onAlias,
  onDelete,
}: {
  s: LinkStats;
  link: LinkDTO | null;
  canWrite: boolean;
  onAlias: () => void;
  onDelete: () => void;
}) {
  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  return (
    <Menu
      align="end"
      label="More actions"
      trigger={
        <span className="grid size-9 place-items-center rounded-lg text-muted transition-[scale,background-color,color] duration-200 ease-out active:scale-[0.96] [@media(hover:hover)]:hover:bg-surface-2 [@media(hover:hover)]:hover:text-text">
          <IconDots size={16} aria-hidden />
        </span>
      }
    >
      <MenuItem onClick={() => open(s.url)}>
        <IconExternalLink size={14} aria-hidden /> Open short link
      </MenuItem>
      <MenuItem onClick={() => open(s.destination)}>
        <IconExternalLink size={14} aria-hidden /> Open destination
      </MenuItem>
      {canWrite && link && (
        <>
          <MenuItem onClick={onAlias}>
            <IconLinkPlus size={14} aria-hidden /> Add another short link
          </MenuItem>
          <MenuSeparator />
          <MenuItem className="text-danger" onClick={onDelete}>
            <IconTrash size={14} aria-hidden /> Delete link
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function LinkDetailHeader({
  s,
  link,
  canWrite,
  orgQr,
  range,
  maxDays,
  onRangeChange,
  onEdit,
  onQr,
  onAlias,
  onDelete,
}: {
  s: LinkStats;
  link: LinkDTO | null;
  canWrite: boolean;
  orgQr: OrgQr;
  range: RangePreset;
  maxDays: number;
  onRangeChange: (range: RangePreset) => void;
  onEdit: () => void;
  onQr: () => void;
  onAlias: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const address = linkDisplayTitle(s.url);
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-4">
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span className="shrink-0" {...morphPart("qr")}>
          <QrThumb url={s.url} link={link} orgQr={orgQr} onOpen={onQr} />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1
              className="truncate text-xl font-semibold tracking-tight"
              title={s.title || address}
              {...morphPart("title")}
            >
              {s.title || address}
            </h1>
            {link?.suspendedAt && (
              <span
                className="shrink-0"
                title="Paused. It does not redirect until we have looked at it. If this is a mistake, write to support and we will restore it."
              >
                <Badge color="pink">paused</Badge>
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1">
            <span className="flex min-w-0" {...morphPart("addr")}>
              <ShortAddress url={s.url} />
            </span>
            <CopyButton
              text={s.url}
              label={`Copy ${s.url}`}
              onCopy={(text) =>
                copyToClipboard(text, toast, { success: `Copied ${linkDisplayTitle(text)}` })
              }
            />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 max-sm:w-full max-sm:flex-wrap">
        <RangeControl
          presets={LINK_RANGES}
          maxDays={maxDays}
          days={range.days}
          bucket="day"
          onChange={onRangeChange}
        />
        <div className="flex items-center gap-2 max-sm:ml-auto">
          {link && canWrite && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
          )}
          {link && (
            <Button variant="outline" size="sm" onClick={onQr}>
              <IconQrcode className="size-4" aria-hidden />
              QR code
            </Button>
          )}
          <div className="w-9">
            <LinkMenu s={s} link={link} canWrite={canWrite} onAlias={onAlias} onDelete={onDelete} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkPanels({ s }: { s: LinkStats }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <PlacesPanel countries={s.countries} limit={7} />
      <PanelTabs
        tabs={[
          {
            value: "referrers",
            label: "Referrers",
            panel: (
              <BarList
                head={["Source", "Clicks"]}
                items={s.referrers}
                formatKey={sourceLabel}
                lead={(key) => <SourceTile source={key} />}
                limit={7}
                empty="Where people were when they followed this link appears here."
              />
            ),
          },
          {
            value: "campaigns",
            label: "Campaigns",
            panel: (
              <BarList
                head={["Campaign", "Clicks"]}
                items={s.campaigns.map((c) => ({ key: c.campaign, clicks: c.clicks }))}
                empty="Tag this link with utm_campaign and its clicks appear here."
              />
            ),
          },
          {
            value: "devices",
            label: "Devices",
            panel: (
              <BarList
                head={["Device", "Clicks"]}
                items={s.devices}
                formatKey={deviceLabel}
                empty="Phone, desktop or tablet, counted here once clicks arrive."
              />
            ),
          },
        ]}
      />
    </div>
  );
}

/** The editor and the QR dialog, open on the link this page shows. */
function useLinkDetailDialogs(orgId: string, link: LinkDTO | null) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [aliasOpen, setAliasOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  // A save the server refused for the destination or the slug: the editor
  // marks that field with it instead of a toast.
  const [saveError, setSaveError] = useState<Error | null>(null);
  const { update } = useLinkMutations(orgId);
  const qc = useQueryClient();
  const toast = useToast();

  const onSave = (data: LinkInput) => {
    if (!link) return;
    setSaveError(null);
    update.mutate(
      { id: link.id, ...data },
      {
        onSuccess: () => {
          posthog.capture("link_updated", linkFeatures(data));
          // The mutation refreshes the list and the org's stats, not this
          // page's: the destination and title here come from linkStats.
          void qc.invalidateQueries({ queryKey: ["linkStats", orgId] });
          setEditorOpen(false);
          toast("Link updated");
        },
        onError: (e: Error) => {
          setSaveError(e);
          if (!linkFieldError(e)) toast(e.message, "error");
          setShakeKey((k) => k + 1);
        },
      },
    );
  };

  return {
    saveError,
    editorOpen,
    setEditorOpen,
    qrOpen,
    setQrOpen,
    aliasOpen,
    setAliasOpen,
    deleteOpen,
    setDeleteOpen,
    shakeKey,
    onSave,
    busy: update.isPending,
  };
}

/** The range a link's page opens on: 30 days, or the plan's whole window
 * when that is shorter. */
const defaultRange = (maxDays: number) => (maxDays >= 30 ? PRESET_30D : PRESET_7D);

/** The figures over the chart, for the range the API answered. */
function linkFigures(s: LinkStats) {
  return [
    { label: "Clicks", value: formatNumber(s.totalClicks), delta: s.totalClicksDelta },
    { label: "Countries", value: formatNumber(s.countryCount) },
    { label: "Top source", value: s.referrers[0] ? sourceLabel(s.referrers[0].key) : "None yet" },
  ];
}

export function LinkDetailPage() {
  const { slug } = useParams({ strict: false });
  const [searchParams] = useSearchParams();
  const domain = searchParams.get("domain");
  // So the way back to Links morphs into this link's row (lib/link-morph.ts).
  useEffect(() => {
    if (slug) setMorphLink(morphKey({ slug, domain }));
  }, [slug, domain]);
  const navigate = useNavigate();
  const { org, orgId, currentUser, canWrite, limits, activeDomains, defaultDomainId, orgQr } =
    useOrgLimits();
  const [picked, setPicked] = useState<RangePreset | null>(null);
  const range = picked ?? defaultRange(limits.analyticsDays);
  const stats = useLinkInsightStats(orgId, slug ?? null, domain, range.days);
  const link = useLinkRow(orgId, stats.data);
  const members = useMembers(orgId);
  const memberNames = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.userId, m.name])),
    [members.data],
  );
  const dialogs = useLinkDetailDialogs(orgId, link);

  if (currentUser.isLoading) return <LinkDetailSkeleton />;
  if (!org) return <NoOrgState />;
  if (stats.isLoading) return <LinkDetailSkeleton />;
  if (!stats.data)
    return <p className="py-8 text-center text-sm text-danger">Could not load link stats.</p>;
  const s = stats.data;
  // Only once the roster is in, so a name never flips from "former member".
  const createdBy =
    members.data === undefined
      ? null
      : (s.createdBy && memberNames.get(s.createdBy)) || "A former member";

  return (
    <div>
      <LinkDetailHeader
        s={s}
        link={link}
        canWrite={canWrite}
        orgQr={orgQr}
        range={range}
        maxDays={limits.analyticsDays}
        onRangeChange={setPicked}
        onEdit={() => dialogs.setEditorOpen(true)}
        onQr={() => dialogs.setQrOpen(true)}
        onAlias={() => dialogs.setAliasOpen(true)}
        onDelete={() => dialogs.setDeleteOpen(true)}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div
          aria-busy={stats.isPlaceholderData}
          className={cn(
            "flex min-w-0 flex-col gap-6 transition-opacity duration-200 ease-out",
            stats.isPlaceholderData && "opacity-60",
          )}
        >
          <StatsChart figures={linkFigures(s)}>
            <div key={s.rangeDays} className="chart-in">
              <AreaChart data={s.series} tickFormat={dayTick} />
            </div>
          </StatsChart>
          <LinkPanels s={s} />
        </div>
        <LinkDetailSide orgId={orgId} stats={s} createdBy={createdBy} />
      </div>

      {link && (
        <>
          <LinkEditor
            open={dialogs.editorOpen}
            onOpenChange={dialogs.setEditorOpen}
            editingLink={link}
            busy={dialogs.busy}
            onSave={dialogs.onSave}
            activeDomains={activeDomains}
            defaultDomainId={defaultDomainId}
            domainsAllowed={limits.domains > 0}
            qrCustomEnabled={limits.qrCustom}
            orgQr={orgQr}
            shakeKey={dialogs.shakeKey}
            saveError={dialogs.saveError}
          />
          <LinkPreviewDialog
            title={`QR · /${link.slug}`}
            link={dialogs.qrOpen ? link : null}
            onClose={() => dialogs.setQrOpen(false)}
            orgQr={orgQr}
          />
          <CreateAliasDialog
            orgId={orgId}
            link={dialogs.aliasOpen ? link : null}
            onClose={() => dialogs.setAliasOpen(false)}
          />
          <DeleteLinkDialog
            orgId={orgId}
            links={dialogs.deleteOpen ? [link] : null}
            onClose={() => dialogs.setDeleteOpen(false)}
            onDeleted={() => void navigate({ to: "/links" })}
          />
        </>
      )}
    </div>
  );
}
