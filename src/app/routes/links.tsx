import { useState, type ReactNode } from "react";
import { lookup } from "@/shared/lookup";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, Ellipsis, Plus, Upload } from "@/app/ui/icons";
import { useLinks, useLinkMutations, useLinkQuotaUsage } from "../lib/hooks";
import { useOrgLimits } from "../lib/org-limits";
import { fetchDownload } from "../lib/api";
import { downloadBlob } from "../lib/csv";
import { type DomainDTO, type LinkDTO, type LinkInput, type Sort } from "@/shared/types";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { buttonClass } from "../ui/button-class";
import { Input } from "../ui/field";
import { Menu, MenuItem, MenuSelect } from "../ui/menu";
import { EmptyState, PageHeader } from "../ui/misc";
import { TableSkeleton } from "../ui/skeleton";
import { LinksSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";
import { NoOrgState } from "../components/no-org";
import { LinkEditor } from "../components/link-editor";
import { LinksTable } from "../components/links-table";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { CreateAliasDialog } from "../components/create-alias-dialog";
import { LinkPreviewDialog } from "../components/link-preview-dialog";
import { linkFeatures, NewLinkButton, useNewLink } from "../components/new-link-host";
import { withErrorToast } from "../lib/mutation-toast";
import { useDebounced } from "../lib/use-debounced";
import posthog from "../lib/posthog";

const PAGE_SIZE = 25;

/** The table's sort keys, as the API names them. */
const API_SORT = {
  createdAt: "created",
  slug: "slug",
  clicks: "clicks",
} satisfies Record<string, "created" | "slug" | "clicks">;

/** The table's controls, and the cursor stack that lets Previous be a step
 * back rather than a re-walk from the top. */
function useLinkPage(orgId: string) {
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  // Index 0 is the first page, whose cursor is nothing. Next pushes the
  // cursor the server handed back; Previous pops.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);

  // The term reaches the server now, so it waits for a pause in typing.
  const q = useDebounced(search);
  const page = cursors.length - 1;

  const links = useLinks(orgId, {
    q,
    domain: domainFilter,
    sort: lookup(API_SORT, sort.key) ?? "created",
    dir: sort.dir === 1 ? "asc" : "desc",
    limit: PAGE_SIZE,
    cursor: cursors[page],
  });

  // Any change to what is being asked for starts the walk again: a cursor
  // belongs to one ordering and one filter, and carrying it across means
  // resuming somebody else's list.
  const restart =
    <T,>(set: (v: T) => void) =>
    (value: T) => {
      set(value);
      setCursors([null]);
    };

  return {
    search,
    onSearchChange: restart(setSearch),
    domainFilter,
    onDomainFilterChange: restart(setDomainFilter),
    sort,
    setSort: restart<Sort>(setSort),
    links,
    rows: links.data?.items ?? [],
    page,
    // While the next page is in flight the query still holds the previous
    // one (keepPreviousData), so its cursor is the one already on the stack.
    // Offering Next again would push it twice: same rows, higher page number.
    hasNext: !links.isPlaceholderData && !!links.data?.nextCursor,
    onNext: () =>
      setCursors((c) => {
        const next = links.data?.nextCursor;
        return next && next !== c[c.length - 1] ? [...c, next] : c;
      }),
    onBack: () => setCursors((c) => (c.length > 1 ? c.slice(0, -1) : c)),
  };
}

/**
 * The searchable, paged table, and the empty state that stands in for it.
 *
 * Split out so the page itself is the header, the dialogs and this: the
 * controls and their wiring are one thing, not eleven props read one at a
 * time in the middle of a route component.
 */
function LinksBrowser({
  list,
  orgId,
  domains,
  navigate,
  dialogs,
  onCreate,
  canWrite,
}: {
  list: ReturnType<typeof useLinkPage>;
  orgId: string;
  domains: DomainDTO[];
  navigate: (to: string) => void;
  dialogs: ReturnType<typeof useLinkDialogs>;
  onCreate?: () => void;
  canWrite: boolean;
}) {
  return (
    <>
      <LinksToolbar
        search={list.search}
        onSearchChange={list.onSearchChange}
        domainFilter={list.domainFilter}
        onDomainFilterChange={list.onDomainFilterChange}
        domains={domains}
      />
      <LinksListArea
        isLoading={list.links.isLoading}
        // An empty first page with nothing typed is an organization with no
        // links. An empty page with a search behind it is a search that found
        // nothing, and the toolbar has to stay on screen to be cleared.
        hasLinks={
          list.rows.length > 0 || !!list.search || list.domainFilter !== "all" || list.page > 0
        }
        onCreate={onCreate}
      >
        <LinksTable
          orgId={orgId}
          paged={list.rows}
          navigate={navigate}
          onQrClick={dialogs.setQrLink}
          canWrite={canWrite}
          onEdit={dialogs.openEdit}
          onDelete={dialogs.setDeleting}
          onCreateAlias={dialogs.setAliasLink}
          sort={list.sort}
          onSort={list.setSort}
          page={list.page}
          hasNext={list.hasNext}
          onNext={list.onNext}
          onBack={list.onBack}
        />
      </LinksListArea>
    </>
  );
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
}: {
  editing: LinkDTO | null;
  update: ReturnType<typeof useLinkMutations>["update"];
  toast: ReturnType<typeof useToast>;
  closeEditor: () => void;
  onSaveError: () => void;
}) {
  return (data: LinkInput) => {
    if (!editing) return;
    update.mutate(
      { id: editing.id, ...data },
      {
        onSuccess: () => {
          posthog.capture("link_updated", linkFeatures(data));
          closeEditor();
          toast("Link updated");
        },
        onError: (e: Error) => {
          toast(e.message, "error");
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

/** "199 of 3,000 on your plan", or "199 links" on a self-hosted instance,
 * which has no cap to count against (its limit is a placeholder of a billion). */
function linkCountLabel(count: number, limit: number, unlimited: boolean): string {
  const n = (v: number) => v.toLocaleString("en-US");
  if (unlimited) return `${n(count)} ${count === 1 ? "link" : "links"}`;
  return `${n(count)} of ${n(limit)} on your plan${count > limit ? " (over the limit)" : ""}`;
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
  const [deleting, setDeleting] = useState<LinkDTO | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

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
  const { update, remove } = useLinkMutations(orgId);
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

  const onSave = buildOnSave({
    editing: dialogs.editing,
    update,
    toast,
    closeEditor: () => dialogs.setEditorOpen(false),
    onSaveError: () => dialogs.setShakeKey((k) => k + 1),
  });

  return (
    <div>
      <PageHeader
        title="Links"
        sub={
          <span className="tnum" title={limitHint}>
            {linkCountLabel(linkCount, limits.links, org.plan === "unlimited")}
          </span>
        }
        action={<LinksActions orgId={orgId} canWrite={canWrite} onNewLink={openNewLink} />}
      />

      <LinksBrowser
        list={list}
        orgId={orgId}
        domains={domains.data ?? []}
        navigate={navigate}
        dialogs={dialogs}
        onCreate={canWrite ? openNewLink : undefined}
        canWrite={canWrite}
      />

      <LinkDialogStack
        dialogs={dialogs}
        orgId={orgId}
        limits={limits}
        activeDomains={activeDomains}
        defaultDomainId={defaultDomainId}
        orgQr={orgQr}
        update={update}
        remove={remove}
        onSave={onSave}
        toast={toast}
      />
    </div>
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
  onNewLink,
}: {
  orgId: string;
  canWrite: boolean;
  onNewLink: () => void;
}) {
  const navigate = useNavigate();
  const { busy, exportLinks } = useExportLinks(orgId);
  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center gap-1 sm:flex">
        {canWrite && (
          <Link to="/import" className={buttonClass({ variant: "ghost" })}>
            <Upload size={15} aria-hidden /> Import
          </Link>
        )}
        <Button variant="ghost" onClick={exportLinks} disabled={busy}>
          {busy ? <Spinner className="size-4" /> : <Download size={15} aria-hidden />}
          Export
        </Button>
      </div>
      <div className="sm:hidden">
        <Menu
          label="More actions"
          align="end"
          trigger={
            <span className={buttonClass({ variant: "outline", className: "w-9 px-0" })}>
              <Ellipsis size={16} aria-hidden />
            </span>
          }
        >
          {canWrite && (
            <MenuItem onClick={() => void navigate({ to: "/import" })}>
              <Upload size={15} aria-hidden /> Import links
            </MenuItem>
          )}
          <MenuItem onClick={exportLinks} disabled={busy}>
            <Download size={15} aria-hidden /> Export as CSV
          </MenuItem>
        </Menu>
      </div>
      {canWrite && <NewLinkButton onClick={onNewLink} />}
    </div>
  );
}

/** Gates only the links results on load/empty state. The toolbar remains
 * mounted: its controls are already usable while the first page is loading,
 * and removing them makes the table jump down on arrival. */
function LinksListArea({
  isLoading,
  hasLinks,
  onCreate,
  children,
}: {
  isLoading: boolean;
  hasLinks: boolean;
  /** Undefined for a viewer, who has no way to make the empty state stop
   * being empty. The screen then explains rather than offering (#157). */
  onCreate?: () => void;
  children: ReactNode;
}) {
  if (isLoading) return <TableSkeleton rows={5} testId="links-table-skeleton" />;
  if (!hasLinks) {
    return (
      <EmptyState
        title="No links yet"
        hint={
          onCreate
            ? "Shorten your first address and it appears here, with its clicks, referrers and QR code."
            : "Links this organization creates appear here, with their clicks, referrers and QR codes."
        }
        action={
          onCreate ? (
            <Button variant="primary" onClick={onCreate}>
              <Plus size={15} /> New link
            </Button>
          ) : undefined
        }
      />
    );
  }
  return <>{children}</>;
}

function DeleteLinkDialog({
  deleting,
  onClose,
  remove,
  toast,
}: {
  deleting: LinkDTO | null;
  onClose: () => void;
  remove: ReturnType<typeof useLinkMutations>["remove"];
  toast: ReturnType<typeof useToast>;
}) {
  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        posthog.capture("link_deleted", { had_custom_domain: deleting.domainId !== null });
        toast("Link deleted");
        onClose();
      },
      onError: withErrorToast(toast),
    });
  };
  return (
    <ConfirmDialog
      title="Delete link"
      open={!!deleting}
      onClose={onClose}
      onConfirm={confirmDelete}
      confirmLabel="Delete link"
      danger
      pending={remove.isPending}
    >
      Delete <span className="font-bold text-accent">/{deleting?.slug}</span>? The short link stops
      working immediately and its click history is removed.
    </ConfirmDialog>
  );
}

/** Search + domain filter bar above the links table. */
function LinksToolbar({
  search,
  onSearchChange,
  domainFilter,
  onDomainFilterChange,
  domains,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  domainFilter: string;
  onDomainFilterChange: (v: string) => void;
  domains: DomainDTO[];
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="Search links"
        placeholder="Search links…"
        className="max-w-64"
      />
      {domains.length > 0 && (
        <div className="w-40">
          <MenuSelect
            label="Domain filter"
            value={domainFilter}
            onChange={onDomainFilterChange}
            options={[
              { value: "all", label: "All domains" },
              { value: "shared", label: "Shared domain" },
              ...domains.map((d) => ({
                value: d.hostname,
                label: d.hostname,
              })),
            ]}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Every dialog the links page can open (#45).
 *
 * They are four separate concerns that happen to share a parent, and holding
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
  update,
  remove,
  onSave,
  toast,
}: {
  dialogs: ReturnType<typeof useLinkDialogs>;
  orgId: string;
  limits: ReturnType<typeof useOrgLimits>["limits"];
  activeDomains: ReturnType<typeof useOrgLimits>["activeDomains"];
  defaultDomainId: string | null;
  orgQr: ReturnType<typeof useOrgLimits>["orgQr"];
  update: ReturnType<typeof useLinkMutations>["update"];
  remove: ReturnType<typeof useLinkMutations>["remove"];
  onSave: (data: LinkInput) => void;
  toast: ReturnType<typeof useToast>;
}) {
  return (
    <>
      <LinkEditor
        open={dialogs.editorOpen}
        onOpenChange={dialogs.setEditorOpen}
        editingLink={dialogs.editing}
        busy={update.isPending}
        onSave={onSave}
        activeDomains={activeDomains}
        defaultDomainId={defaultDomainId}
        domainsAllowed={limits.domains > 0}
        qrCustomEnabled={limits.qrCustom}
        orgQr={orgQr}
        shakeKey={dialogs.shakeKey}
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
        deleting={dialogs.deleting}
        onClose={() => dialogs.setDeleting(null)}
        remove={remove}
        toast={toast}
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
