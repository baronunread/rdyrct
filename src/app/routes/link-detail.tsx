import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "../lib/router-search";
import { ArrowLeft, ExternalLink, QrCode } from "@/app/ui/icons";
import { useLinkStats, useLinks, useLinkMutations, useMembers } from "../lib/hooks";
import { useOrgLimits } from "../lib/org-limits";
import { AreaChart, BarList, StatsChart } from "../components/charts";
import { CountryMap } from "../components/country-map";
import { NoOrgState } from "../components/no-org";
import { LinkEditor } from "../components/link-editor";
import { LinkPreviewDialog } from "../components/link-preview-dialog";
import { linkFeatures } from "../components/new-link-host";
import { LinkDetailSide } from "../components/link-detail-side";
import { LinkDetailSkeleton } from "../components/skeletons";
import { Badge } from "../ui/misc";
import { Button } from "../ui/button";
import { CopyButton } from "../ui/copy-button";
import { PanelTabs } from "../ui/tabs";
import { useToast } from "../ui/toast";
import { copyToClipboard } from "../lib/clipboard";
import { formatNumber } from "../lib/numbers";
import { linkDisplayTitle } from "../lib/link-display";
import posthog from "../lib/posthog";
import type { LinkDTO, LinkInput, LinkStats } from "@/shared/types";

/** "Oct 5" from "2026-10-05". */
const dayTick = (day: string) =>
  new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const COUNTRY_NAMES = new Intl.DisplayNames("en", { type: "region" });
function countryName(code: string): string {
  try {
    return COUNTRY_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
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
  const links = useLinks(s ? orgId : "", { q: s?.slug ?? "", limit: 100 });
  if (!s) return null;
  return links.data?.items.find((l) => l.id === s.id) ?? null;
}

function LinkDetailHeader({
  s,
  link,
  canWrite,
  onEdit,
  onQr,
}: {
  s: LinkStats;
  link: LinkDTO | null;
  canWrite: boolean;
  onEdit: () => void;
  onQr: () => void;
}) {
  const toast = useToast();
  const address = linkDisplayTitle(s.url);
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        {/* One control, the link itself: a button inside it gave Tab two stops. */}
        <Link
          to="/links"
          aria-label="Back to links"
          title="Back to links"
          className="-ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h1
              className="truncate text-xl font-semibold tracking-tight"
              title={s.title || address}
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
            <span className="truncate font-mono text-sm text-muted" title={address}>
              {address}
            </span>
            <CopyButton
              text={s.url}
              label={`Copy ${s.url}`}
              onCopy={(text) => copyToClipboard(text, toast)}
            />
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-text"
              aria-label="Open link in new tab"
              title={s.url}
            >
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </div>
      {link && (
        <div className="flex shrink-0 items-center gap-2">
          {canWrite && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              Edit
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onQr}>
            <QrCode className="size-4" aria-hidden />
            QR code
          </Button>
        </div>
      )}
    </div>
  );
}

function LinkPanels({ s }: { s: LinkStats }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <PanelTabs
        tabs={[
          {
            value: "countries",
            label: "Countries",
            panel: (
              <BarList
                head={["Country", "Clicks"]}
                items={s.countries.map((c) => ({ ...c, key: countryName(c.key) }))}
                empty="The country each click came from appears here. Never the address it came from."
              />
            ),
          },
          { value: "map", label: "Map", panel: <CountryMap countries={s.countries} /> },
        ]}
      />
      <PanelTabs
        tabs={[
          {
            value: "referrers",
            label: "Referrers",
            panel: (
              <BarList
                head={["Source", "Clicks"]}
                items={s.referrers}
                empty="Where people were when they followed this link appears here."
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
  const [shakeKey, setShakeKey] = useState(0);
  const { update } = useLinkMutations(orgId);
  const qc = useQueryClient();
  const toast = useToast();

  const onSave = (data: LinkInput) => {
    if (!link) return;
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
          toast(e.message, "error");
          setShakeKey((k) => k + 1);
        },
      },
    );
  };

  return { editorOpen, setEditorOpen, qrOpen, setQrOpen, shakeKey, onSave, busy: update.isPending };
}

export function LinkDetailPage() {
  const { slug } = useParams({ strict: false });
  const [searchParams] = useSearchParams();
  const domain = searchParams.get("domain");
  const { org, orgId, currentUser, canWrite, limits, activeDomains, defaultDomainId, orgQr } =
    useOrgLimits();
  const stats = useLinkStats(orgId, slug ?? null, domain);
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
        onEdit={() => dialogs.setEditorOpen(true)}
        onQr={() => dialogs.setQrOpen(true)}
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <StatsChart
            figures={[
              {
                label: `Total clicks · ${s.rangeDays}d`,
                value: formatNumber(s.totalClicks),
                delta: s.totalClicksDelta,
              },
              { label: "Clicks · 7d", value: formatNumber(s.clicks7d), delta: s.clicks7dDelta },
              {
                label: "Top country",
                value: s.countries[0] ? countryName(s.countries[0].key) : "None yet",
              },
              { label: "Top source", value: s.referrers[0]?.key ?? "None yet" },
            ]}
          >
            <AreaChart data={s.series} tickFormat={dayTick} />
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
          />
          <LinkPreviewDialog
            title={`QR · /${link.slug}`}
            link={dialogs.qrOpen ? link : null}
            onClose={() => dialogs.setQrOpen(false)}
            orgQr={orgQr}
          />
        </>
      )}
    </div>
  );
}
