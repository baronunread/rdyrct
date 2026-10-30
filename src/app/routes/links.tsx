import { linkFieldError } from "../lib/link-field-errors";
import { useState, type ReactNode } from "react";
import { lookup } from "@/shared/lookup";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  IconDots,
  IconDownload,
  IconLink,
  IconPlus,
  IconSearch,
  IconUpload,
} from "@tabler/icons-react";
import { Kbd } from "../ui/kbd";
import type { QueryClient } from "@tanstack/react-query";
import {
  linkQuotaUsageQuery,
  membersQuery,
  useLinkMutations,
  useLinkQuotaUsage,
} from "../lib/hooks";
import { preloadOrgDomains, useOrgLimits } from "../lib/org-limits";
import { settle, type PageContext } from "../lib/route-preload";
import { fetchDownload } from "../lib/api";
import { downloadBlob } from "../lib/csv";
import {
  type DomainDTO,
  type LinkDTO,
  type LinkFacets,
  type LinkFilter,
  type LinkInput,
  type Sort,
} from "@/shared/types";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { buttonClass } from "../ui/button-class";
import { Input } from "../ui/field";
import { Menu, MenuItem, MenuSelect } from "../ui/menu";
import { PageHeader } from "../ui/misc";
import { Skeleton } from "../ui/skeleton";
import { Tooltip } from "../ui/tooltip";
import { FilterChips } from "../ui/filter-chips";
import { LinksSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";
import { NoOrgState } from "../components/no-org";
import { LinkEditor } from "../components/link-editor";
import { LinksTable } from "../components/links-table";
import { BulkBar } from "../components/bulk-bar";
import { DeleteLinkDialog } from "../components/delete-link-dialog";
import { CreateAliasDialog } from "../components/create-alias-dialog";
import { LinkPreviewDialog } from "../components/link-preview-dialog";
import { NewLinkButton, useNewLink } from "../components/new-link-host";
import { linkFeatures } from "../lib/links-data";
import { displayHost } from "../lib/display-url";
import { useDebounced } from "../lib/use-debounced";
import { downloadQrCodes } from "../lib/bulk-qr";
import {
  linkFacetsQuery,
  linkRowsQuery,
  useCreatorNames,
  useLinkFacets,
  useLinkRows,
  type LinkPageQuery,
} from "../lib/links-data";
import posthog from "../lib/posthog";

const PAGE_SIZE = 25;

/** The table's sort keys, as the API names them. */
const API_SORT = {
  createdAt: "created",
  slug: "slug",
  clicks: "clicks",
} satisfies Record<string, "created" | "slug" | "clicks">;

/** Which facet count belongs to which chip. */
const FACET_OF = {
  all: "all",
  attention: "attention",
  qr: "qr",
  custom: "customDomain",
} satisfies Record<LinkFilter, keyof LinkFacets>;

const READ_ONLY = "This organization is read-only";

/** Newest first, the order the table opens in. */
const DEFAULT_SORT: Sort = { key: "createdAt", dir: -1 };

/** The page of rows the table's controls ask for. */
function rowsQuery(
  q: string,
  domain: string,
  filter: LinkFilter,
  sort: Sort,
  cursor: string | null,
): LinkPageQuery {
  return {
    q,
    domain,
    filter,
    sort: lookup(API_SORT, sort.key) ?? "created",
    dir: sort.dir === 1 ? "asc" : "desc",
    limit: PAGE_SIZE,
    cursor,
  };
}

/** Everything the Links page's first frame reads (see lib/route-preload.ts):
 * the first page of rows as the table opens, the chip counts, the quota, the
 * creator names and the domains the toolbar filters by. */
export function preload(qc: QueryClient, orgId: string, { org, user }: PageContext) {
  return settle([
    qc.ensureQueryData(linkRowsQuery(orgId, rowsQuery("", "all", "all", DEFAULT_SORT, null))),
    qc.ensureQueryData(linkFacetsQuery(orgId)),
    qc.ensureQueryData(linkQuotaUsageQuery(orgId)),
    qc.ensureQueryData(membersQuery(orgId)),
    preloadOrgDomains(qc, org, user),
  ]);
}

/** The table's controls, the cursor stack that lets Previous be a step back
 * rather than a re-walk from the top, and the ticked rows. */
function useLinkPage(orgId: string) {
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [filter, setFilter] = useState<LinkFilter>("all");
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  // Index 0 is the first page, whose cursor is nothing. Next pushes the
  // cursor the server handed back; Previous pops.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  // Ticked rows belong to the page on screen: a selection that outlived a
  // page change would act on rows nobody can see.
  const [selection, setSelection] = useState<Set<string>>(new Set());

  // The term reaches the server now, so it waits for a pause in typing.
  const q = useDebounced(search);
  const page = cursors.length - 1;

  const links = useLinkRows(orgId, rowsQuery(q, domainFilter, filter, sort, cursors[page]));

  // Any change to what is being asked for starts the walk again: a cursor
  // belongs to one ordering and one filter, and carrying it across means
  // resuming somebody else's list.
  const restart =
    <T,>(set: (v: T) => void) =>
    (value: T) => {
      set(value);
      setCursors([null]);
      setSelection(new Set());
    };

  return {
    search,
    onSearchChange: restart(setSearch),
    domainFilter,
    onDomainFilterChange: restart(setDomainFilter),
    filter,
    onFilterChange: restart(setFilter),
    sort,
    setSort: restart<Sort>(setSort),
    links,
    rows: links.data?.items ?? [],
    page,
    // Searching or picking one domain narrows past what the facet counts
    // describe, so only the plain list has a total to show.
    narrowed: !!q || domainFilter !== "all",
    selection,
    setSelection,
    // While the next page is in flight the query still holds the previous
    // one (keepPreviousData), so its cursor is the one already on the stack.
    // Offering Next again would push it twice: same rows, higher page number.
    hasNext: !links.isPlaceholderData && !!links.data?.nextCursor,
    onNext: () => {
      setSelection(new Set());
      setCursors((c) => {
        const next = links.data?.nextCursor;
        return next && next !== c[c.length - 1] ? [...c, next] : c;
      });
    },
    onBack: () => {
      setSelection(new Set());
      setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c));
    },
  };
}

/** The editor's onSave on this page: creating lives in the New link dialog
 * (NewLinkHost), so here it only ever saves an edit. A rejected save bumps
 * the editor's shake counter so its Save button flags the failure. */
function buildOnSave({
  editing,
  update,
  toast,
  closeEditor,
  onSaveError,
  setSaveError,
}: {
  setSaveError: (e: Error | null) => void;
  editing: LinkDTO | null;
  update: ReturnType<typeof useLinkMutations>["update"];
  toast: ReturnType<typeof useToast>;
  closeEditor: () => void;
  onSaveError: () => void;
}) {
  return (data: LinkInput) => {
    if (!editing) return;
    setSaveError(null);
    update.mutate(
      { id: editing.id, ...data },
      {
        onSuccess: () => {
          posthog.capture("link_updated", linkFeatures(data));
          closeEditor();
          toast("Link updated");
        },
        onError: (e: Error) => {
          setSaveError(e);
          if (!linkFieldError(e)) toast(e.message, "error");
          onSaveError();
        },
      },
    );
  };
}

/**
 * What the links counter says when it is worth saying something (#163).
 *
 * "Over" and "at" used to read the same, so an org holding 500 links on a
 * 30-link plan was told to "upgrade for more" as though it were one short.
 */
function linkLimitHint(count: number, limit: number): string | undefined {
  if (count > limit)
    return `This plan allows ${limit} links. The extras still work, and you can delete some or upgrade.`;
  if (count === limit) return "Link limit reached: upgrade for more links";
  return undefined;
}

/** "199 short links of 3,000 on your plan", or "199 short links" on a
 * self-hosted instance, which has no cap to count against (its limit is a
 * placeholder of a billion). "Short links", not "links": the plan counts
 * every address, a link's extra ones included, so this runs ahead of the
 * All chip's count of links and has to say why. */
function LinkCountLabel({
  count,
  limit,
  unlimited,
}: {
  count: number;
  limit: number;
  unlimited: boolean;
}) {
  const n = (v: number) => v.toLocaleString("en-US");
  const what = count === 1 ? "short link" : "short links";
  if (unlimited) return <>{`${n(count)} ${what}`}</>;
  return (
    <>
      {n(count)} {what} of {n(limit)}
      <span className="max-sm:hidden"> on your plan</span>
      {count > limit ? " (over the limit)" : ""}
    </>
  );
}

/**
 * Which dialog is open, and what it is open about (#45): the editor, the QR
 * preview, the alias dialog, the delete confirmation, and the shake that
 * fires when a save fails. One named thing the page reads off.
 */
function useLinkDialogs() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LinkDTO | null>(null);
  const [qrLink, setQrLink] = useState<LinkDTO | null>(null);
  const [aliasLink, setAliasLink] = useState<LinkDTO | null>(null);
  const [deleting, setDeleting] = useState<LinkDTO[] | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  // A save the server refused for the destination or the slug: the editor
  // marks that field with it instead of a toast.
  const [saveError, setSaveError] = useState<Error | null>(null);

  return {
    editorOpen,
    setEditorOpen,
    editing,
    setEditing,
    qrLink,
    setQrLink,
    aliasLink,
    setAliasLink,
    deleting,
    setDeleting,
    shakeKey,
    setShakeKey,
    saveError,
    setSaveError,
    openEdit: (link: LinkDTO) => {
      setEditing(link);
      setEditorOpen(true);
    },
  };
}

export function LinksPage() {
  const {
    org,
    orgId,
    limits,
    canWrite,
    activeDomains,
    defaultDomainId,
    orgQr,
    domains,
    currentUser,
  } = useOrgLimits();
  const quotaUsage = useLinkQuotaUsage(orgId);
  const { update } = useLinkMutations(orgId);
  const { openNewLink } = useNewLink();
  const toast = useToast();
  const routerNavigate = useNavigate();
  const navigate = (to: string) => void routerNavigate({ href: to });

  // Links used against the plan cap, not the number of rows in the table: a
  // link plus its kept-forever aliases each count. See useLinkQuotaUsage.
  const linkCount = quotaUsage.data?.count ?? 0;
  const limitHint = linkLimitHint(linkCount, limits.links);

  const dialogs = useLinkDialogs();
  const list = useLinkPage(orgId);

  // The cached shell may know the organization before /user confirms the
  // current role and plan. Do not briefly offer a stale create control.
  if (currentUser.isLoading) return <LinksSkeleton />;
  if (!org) return <NoOrgState />;

  // A read-only org is one whose role would allow writing: its New link and
  // Import stay on screen, greyed, and say why. A viewer is offered neither.
  const readOnly = !!org.locked && org.role !== "viewer";

  const onSave = buildOnSave({
    editing: dialogs.editing,
    update,
    toast,
    closeEditor: () => dialogs.setEditorOpen(false),
    onSaveError: () => dialogs.setShakeKey((k) => k + 1),
    setSaveError: dialogs.setSaveError,
  });

  return (
    <div>
      <PageHeader
        title="Links"
        sub={
          <span className="tnum" title={limitHint}>
            <LinkCountLabel
              count={linkCount}
              limit={limits.links}
              unlimited={org.plan === "unlimited"}
            />
          </span>
        }
        action={
          <LinksActions
            orgId={orgId}
            canWrite={canWrite}
            readOnly={readOnly}
            // Nothing to export and the empty state offers the import, so
            // the header keeps New link alone.
            empty={quotaUsage.data?.count === 0}
            onNewLink={openNewLink}
          />
        }
      />
      {readOnly && (
        <p className="-mt-3 mb-5 text-xs text-muted">
          You can still export: it is how you take your links with you.
        </p>
      )}

      <LinksBrowser
        list={list}
        orgId={orgId}
        domains={domains.data ?? []}
        navigate={navigate}
        dialogs={dialogs}
        onCreate={canWrite ? openNewLink : undefined}
        canWrite={canWrite}
        onDownloadQr={(links) => downloadQrCodes(links, orgQr)}
      />

      <LinkDialogStack
        dialogs={dialogs}
        orgId={orgId}
        limits={limits}
        activeDomains={activeDomains}
        defaultDomainId={defaultDomainId}
        orgQr={orgQr}
        busy={update.isPending}
        onSave={onSave}
        onDeleted={(ids) => {
          const next = new Set(list.selection);
          for (const id of ids) next.delete(id);
          list.setSelection(next);
        }}
      />
    </div>
  );
}

/** A control the org's lock switched off: on screen, greyed, and saying why
 * on hover or focus, rather than gone without a word. */
function ReadOnlyButton({
  variant,
  children,
}: {
  variant: "primary" | "ghost";
  children: ReactNode;
}) {
  // aria-disabled rather than disabled, the way the dashboard's New link
  // does it: a disabled button takes no hover or focus, so its tooltip
  // could never say why.
  return (
    <Tooltip content={READ_ONLY}>
      <Button
        variant={variant}
        aria-disabled
        static
        className="cursor-not-allowed opacity-45"
        onClick={(e) => e.preventDefault()}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

/**
 * Import, Export and New link. One primary button; Import and Export are
 * quiet beside it on a wide screen and share a menu on a phone, where the
 * header has room for New link alone. Export stays for a viewer and in a
 * locked org: it is how people take their links with them.
 */
function LinksActions({
  orgId,
  canWrite,
  readOnly,
  empty,
  onNewLink,
}: {
  orgId: string;
  canWrite: boolean;
  readOnly: boolean;
  empty: boolean;
  onNewLink: () => void;
}) {
  const navigate = useNavigate();
  const { busy, exportLinks } = useExportLinks(orgId);
  const exportIcon = busy ? (
    <Spinner className="size-4" />
  ) : (
    <IconDownload size={15} stroke={1.75} aria-hidden />
  );
  return (
    <div className="flex items-center gap-2">
      {!empty && (
        <div className="hidden items-center gap-1 sm:flex">
          {canWrite && (
            <Link to="/import" className={buttonClass({ variant: "ghost" })}>
              <IconUpload size={15} stroke={1.75} aria-hidden /> Import
            </Link>
          )}
          {readOnly && (
            <ReadOnlyButton variant="ghost">
              <IconUpload size={15} stroke={1.75} aria-hidden /> Import
            </ReadOnlyButton>
          )}
          <Button variant="ghost" onClick={exportLinks} disabled={busy}>
            {exportIcon}
            Export
          </Button>
        </div>
      )}
      {!empty && (
        <div className="sm:hidden">
          <Menu
            label="More actions"
            align="end"
            trigger={
              <span className={buttonClass({ variant: "outline", className: "w-10 px-0" })}>
                <IconDots size={16} aria-hidden />
              </span>
            }
          >
            {(canWrite || readOnly) && (
              <MenuItem disabled={readOnly} onClick={() => void navigate({ to: "/import" })}>
                <IconUpload size={15} stroke={1.75} aria-hidden /> Import links
              </MenuItem>
            )}
            <MenuItem onClick={exportLinks} disabled={busy}>
              {exportIcon} Export as CSV
            </MenuItem>
          </Menu>
        </div>
      )}
      {canWrite && <NewLinkButton onClick={onNewLink} />}
      {readOnly && (
        <ReadOnlyButton variant="primary">
          <IconPlus size={15} aria-hidden /> New link
          <Kbd tone="primary" className="ml-0.5 max-sm:hidden">
            C
          </Kbd>
        </ReadOnlyButton>
      )}
    </div>
  );
}

/**
 * The filters, the table and its paging, or the empty state that stands in
 * for all three. Split out so the page itself is the header, the dialogs and
 * this.
 */
function LinksBrowser({
  list,
  orgId,
  domains,
  navigate,
  dialogs,
  onCreate,
  canWrite,
  onDownloadQr,
}: {
  list: ReturnType<typeof useLinkPage>;
  orgId: string;
  domains: DomainDTO[];
  navigate: (to: string) => void;
  dialogs: ReturnType<typeof useLinkDialogs>;
  onCreate?: () => void;
  canWrite: boolean;
  onDownloadQr: (links: LinkDTO[]) => Promise<void>;
}) {
  const facets = useLinkFacets(orgId);
  const creators = useCreatorNames(orgId);
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);

  const filtered =
    !!list.search || list.domainFilter !== "all" || list.filter !== "all" || list.page > 0;
  // An empty first page with nothing typed is an organization with no
  // links. An empty page with a search behind it is a search that found
  // nothing, and the toolbar has to stay on screen to be cleared.
  // Only the list itself says so: the quota count can be a moment stale, and
  // while the first page loads the toolbar and skeleton hold the table's place.
  const empty = !filtered && !list.links.isLoading && list.rows.length === 0;

  if (empty) return <NoLinksYet onCreate={onCreate} />;

  const ticked = list.rows.filter((row) => list.selection.has(row.id));
  const total = facets.data && !list.narrowed ? facets.data[FACET_OF[list.filter]] : undefined;

  const downloadQr = async () => {
    setDownloading(true);
    try {
      await onDownloadQr(ticked);
      posthog.capture("qr_codes_bulk_downloaded", { count: ticked.length });
    } catch {
      toast("Could not make the QR codes. Try again.", "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {ticked.length > 0 ? (
        <BulkBar
          count={ticked.length}
          onDownloadQr={() => void downloadQr()}
          downloading={downloading}
          onDelete={canWrite ? () => dialogs.setDeleting(ticked) : undefined}
          onClear={() => list.setSelection(new Set())}
        />
      ) : (
        <LinksToolbar list={list} facets={facets.data} domains={domains} />
      )}
      {list.links.isLoading ? (
        <LinkRowsSkeleton />
      ) : list.rows.length === 0 ? (
        <NothingFound />
      ) : (
        <LinksTable
          orgId={orgId}
          rows={list.rows}
          navigate={navigate}
          onQrClick={dialogs.setQrLink}
          canWrite={canWrite}
          onEdit={dialogs.openEdit}
          onDelete={(link) => dialogs.setDeleting([link])}
          onCreateAlias={dialogs.setAliasLink}
          sort={list.sort}
          onSort={list.setSort}
          selection={list.selection}
          onSelectionChange={list.setSelection}
          creators={creators}
          paging={{
            page: list.page,
            pageSize: PAGE_SIZE,
            total,
            hasNext: list.hasNext,
            onNext: list.onNext,
            onBack: list.onBack,
          }}
        />
      )}
    </div>
  );
}

/** Rows standing in for the first page, in the table's own shape: a card,
 * a thumbnail, two lines, a number. */
function LinkRowsSkeleton() {
  return (
    <div
      role="status"
      data-testid="links-table-skeleton"
      className="overflow-hidden rounded-xl bg-surface smooth-shadow-ring-xs"
    >
      <span className="sr-only">Loading links</span>
      <div className="h-9 border-b border-border" />
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="flex h-[61px] items-center gap-3 border-b border-border/50 px-3 last:border-b-0 sm:pl-14"
        >
          <Skeleton className="size-8 rounded-md sm:size-7" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-40 max-w-full" />
            <Skeleton className="h-2.5 w-56 max-w-full" />
          </div>
          <Skeleton className="h-3 w-8" />
          <Skeleton className="mr-3 hidden h-3 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}

function NothingFound() {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl py-14 text-center smooth-shadow-ring-xs">
      <p className="font-semibold">No links match</p>
      <p className="text-sm text-muted">Try another word, or clear the filters.</p>
    </div>
  );
}

/** The first screen of an empty organization: what will appear, one way to
 * make it appear, and the other way for somebody arriving from another
 * shortener. No search box: there is nothing to search. */
function NoLinksYet({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-xl px-4 py-12 text-center smooth-shadow-ring-xs sm:px-6">
      <span className="mb-1 grid size-11 place-items-center rounded-xl bg-bg text-muted">
        <IconLink size={20} stroke={1.75} aria-hidden />
      </span>
      <h2 className="text-base font-semibold">No links yet</h2>
      <p className="max-w-[44ch] text-sm text-pretty text-muted">
        {onCreate
          ? "Shorten a long URL and it shows up here, with its clicks and its QR code."
          : "Links this organization creates show up here, with their clicks and QR codes."}
      </p>
      {onCreate && (
        <div className="mt-1 flex flex-col items-center gap-2.5">
          <NewLinkButton onClick={onCreate} />
          <Link
            to="/import"
            className="text-xs text-muted underline decoration-border underline-offset-2 [@media(hover:hover)]:hover:text-text"
          >
            Or import from Bitly, Short.io, Rebrandly or Dub
          </Link>
        </div>
      )}
    </div>
  );
}

/** Filter chips on the left, search and domain on the right; on a phone the
 * search goes full width with the chips scrolling under it. The row is the
 * bulk bar's height, so swapping the two never moves the table. */
function LinksToolbar({
  list,
  facets,
  domains,
}: {
  list: ReturnType<typeof useLinkPage>;
  facets: LinkFacets | undefined;
  domains: DomainDTO[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:min-h-11 sm:flex-row sm:items-center sm:justify-between">
      {facets ? (
        <FilterChips
          label="Show"
          value={list.filter}
          onChange={list.onFilterChange}
          className="order-2 sm:order-1"
          items={[
            { id: "all", label: "All", count: facets.all },
            { id: "attention", label: "Needs attention", count: facets.attention },
            { id: "qr", label: "QR codes", count: facets.qr },
            ...(domains.length > 0
              ? [{ id: "custom" as const, label: "Custom domain", count: facets.customDomain }]
              : []),
          ]}
        />
      ) : (
        <span className="order-2 max-sm:hidden sm:order-1" />
      )}
      <div className="order-1 flex gap-2 sm:order-2">
        <label className="relative block min-w-0 flex-1 sm:w-64 sm:flex-none">
          <IconSearch
            size={15}
            stroke={1.75}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-placeholder"
          />
          <Input
            type="text"
            inputMode="search"
            enterKeyHint="search"
            value={list.search}
            onChange={(e) => list.onSearchChange(e.target.value)}
            aria-label="Search links"
            placeholder="Search links"
            className="h-11 pl-9 sm:h-9"
          />
        </label>
        {domains.length > 0 && (
          <div className="w-44 shrink-0 max-sm:hidden">
            <MenuSelect
              label="Domain filter"
              value={list.domainFilter}
              onChange={list.onDomainFilterChange}
              options={[
                { value: "all", label: "All domains" },
                { value: "shared", label: "Shared domain" },
                ...domains.map((d) => ({ value: d.hostname, label: displayHost(d.hostname) })),
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Every dialog the links page can open (#45).
 *
 * They are separate concerns that happen to share a parent, and holding
 * them in the page meant every one of their conditions counted against the
 * page's own complexity. The page now says "and the dialogs", once.
 */
function LinkDialogStack({
  dialogs,
  orgId,
  limits,
  activeDomains,
  defaultDomainId,
  orgQr,
  busy,
  onSave,
  onDeleted,
}: {
  dialogs: ReturnType<typeof useLinkDialogs>;
  orgId: string;
  limits: ReturnType<typeof useOrgLimits>["limits"];
  activeDomains: ReturnType<typeof useOrgLimits>["activeDomains"];
  defaultDomainId: string | null;
  orgQr: ReturnType<typeof useOrgLimits>["orgQr"];
  busy: boolean;
  onSave: (data: LinkInput) => void;
  onDeleted: (ids: string[]) => void;
}) {
  const editing = dialogs.editing;
  return (
    <>
      <LinkEditor
        open={dialogs.editorOpen}
        onOpenChange={dialogs.setEditorOpen}
        editingLink={editing}
        busy={busy}
        onSave={onSave}
        activeDomains={activeDomains}
        defaultDomainId={defaultDomainId}
        domainsAllowed={limits.domains > 0}
        qrCustomEnabled={limits.qrCustom}
        orgQr={orgQr}
        shakeKey={dialogs.shakeKey}
        saveError={dialogs.saveError}
        // The editor's footer Delete hands over to the same confirmation the
        // row menu opens, so there is one way a link gets deleted.
        onDelete={
          editing
            ? () => {
                dialogs.setEditorOpen(false);
                dialogs.setDeleting([editing]);
              }
            : undefined
        }
      />

      <LinkPreviewDialog
        title={dialogs.qrLink ? `QR · /${dialogs.qrLink.slug}` : "QR"}
        link={dialogs.qrLink}
        onClose={() => dialogs.setQrLink(null)}
        orgQr={orgQr}
      />

      <CreateAliasDialog
        orgId={orgId}
        link={dialogs.aliasLink}
        onClose={() => dialogs.setAliasLink(null)}
      />

      <DeleteLinkDialog
        orgId={orgId}
        links={dialogs.deleting}
        onClose={() => dialogs.setDeleting(null)}
        onDeleted={onDeleted}
      />
    </>
  );
}

/** Every link in the org as a CSV the import reads back (#75). Any member
 * can export, a locked org included: it is how people take their data out. */
function useExportLinks(orgId: string) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const exportLinks = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await fetchDownload(`/orgs/${orgId}/link-export`);
      downloadBlob(filename, blob);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not export your links", "error");
    } finally {
      setBusy(false);
    }
  };
  return { busy, exportLinks };
}
