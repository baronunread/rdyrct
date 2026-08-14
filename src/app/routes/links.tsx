import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { useLinks, useLinkMutations, useLinkQuotaUsage } from "../lib/hooks";
import { useOrgLimits } from "../lib/org-limits";
import { ApiError } from "../lib/api";
import { type DomainDTO, type LinkDTO, type LinkInput, type Sort } from "@/shared/types";
import { Button } from "../ui/button";
import { Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { EmptyState, PageHeader } from "../ui/misc";
import { TableSkeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { NoOrgState } from "../components/no-org";
import { sortRows } from "../lib/sort";
import { LinkEditor } from "../components/link-editor";
import { LinksTable } from "../components/links-table";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { SameDestinationDialog } from "../components/same-destination-dialog";
import { CreateAliasDialog } from "../components/create-alias-dialog";
import { LinkPreviewDialog } from "../components/link-preview-dialog";
import { withErrorToast } from "../lib/mutation-toast";
import posthog from "../lib/posthog";

const PAGE_SIZE = 25;

function useLinkFilter(links: { data?: LinkDTO[] }) {
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let list = links.data ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.slug.toLowerCase().includes(q) ||
          l.destination.toLowerCase().includes(q) ||
          l.title.toLowerCase().includes(q),
      );
    }
    if (domainFilter !== "all") {
      list = list.filter((l) =>
        domainFilter === "shared" ? !l.domain : l.domain === domainFilter,
      );
    }
    return sortRows(list, sort, {
      clicks: (l) => l.clicks,
      slug: (l) => l.slug,
      createdAt: (l) => l.createdAt,
    });
  }, [links.data, search, domainFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const onSearchChange = (v: string) => {
    setSearch(v);
    setPage(0);
  };
  const onDomainFilterChange = (v: string) => {
    setDomainFilter(v);
    setPage(0);
  };

  return {
    search,
    setSearch,
    domainFilter,
    setDomainFilter,
    sort,
    setSort,
    page,
    setPage,
    filtered,
    totalPages,
    safePage,
    paged,
    onSearchChange,
    onDomainFilterChange,
  };
}

/** What a saved link used, for PostHog. Four questions, each of them "did they
 * fill in any of these fields", which is why they read as one thing here and
 * not as branches in the success handler. */
function linkFeatures(data: LinkInput) {
  const any = (...fields: (string | null | undefined)[]) => fields.some(Boolean);
  return {
    has_custom_domain: data.domainId !== null,
    has_custom_slug: Boolean(data.slug?.trim()),
    has_qr_customization: any(data.qrStyle, data.qrColor, data.qrCorner, data.qrLogo),
    has_utm_parameters: any(
      data.utmSource,
      data.utmMedium,
      data.utmCampaign,
      data.utmTerm,
      data.utmContent,
    ),
  };
}

/** Builds the LinkEditor's onSave handler: PATCH when editing, POST when
 * creating, sharing one success/error path (and bumping the editor's shake
 * counter on any rejected save, so its Save button flags the failure). */
function buildOnSave({
  editing,
  create,
  update,
  toast,
  closeEditor,
  onSaveError,
  onSameDestinationMatch,
}: {
  editing: LinkDTO | null;
  create: ReturnType<typeof useLinkMutations>["create"];
  update: ReturnType<typeof useLinkMutations>["update"];
  toast: ReturnType<typeof useToast>;
  closeEditor: () => void;
  onSaveError: () => void;
  onSameDestinationMatch: (input: LinkInput, matchedLinks: LinkDTO[]) => void;
}) {
  return (data: LinkInput) => {
    const done = {
      onSuccess: () => {
        posthog.capture(editing ? "link_updated" : "link_created", linkFeatures(data));
        closeEditor();
        toast(editing ? "Link updated" : "Link created");
      },
      onError: (e: Error) => {
        if (e instanceof ApiError && e.code === "same_destination_match") {
          const { matchedLinks } = e.data as { matchedLinks: LinkDTO[] };
          onSameDestinationMatch(data, matchedLinks);
          return;
        }
        toast(e.message, "error");
        onSaveError();
      },
    };
    if (editing) update.mutate({ id: editing.id, ...data }, done);
    else create.mutate(data, done);
  };
}

/**
 * Which dialog is open, and what it is open about (#45).
 *
 * Six pieces of state that only ever describe one thing: the editor, the QR
 * preview, the alias dialog, the delete confirmation, the duplicate-destination
 * prompt, and the shake that fires when a save fails. They lived inline and
 * made LinksPage the most complex function in the app; here they are one
 * named thing the page reads off.
 */
function useLinkDialogs(atLimit: boolean) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LinkDTO | null>(null);
  const [qrLink, setQrLink] = useState<LinkDTO | null>(null);
  const [aliasLink, setAliasLink] = useState<LinkDTO | null>(null);
  const [deleting, setDeleting] = useState<LinkDTO | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [sameDestination, setSameDestination] = useState<{
    input: LinkInput;
    matchedLinks: LinkDTO[];
  } | null>(null);

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
    sameDestination,
    setSameDestination,
    openCreate: () => {
      if (atLimit) return;
      setEditing(null);
      setEditorOpen(true);
    },
    openEdit: (link: LinkDTO) => {
      setEditing(link);
      setEditorOpen(true);
    },
  };
}

export function LinksPage() {
  const { org, orgId, limits, activeDomains, defaultDomainId, orgQr, domains } = useOrgLimits();
  const links = useLinks(orgId);
  const quotaUsage = useLinkQuotaUsage(orgId);
  const { create, update, remove } = useLinkMutations(orgId);
  const toast = useToast();
  const navigate = useNavigate();

  // Links used against the plan cap, not the number of rows in the table: a
  // link plus its kept-forever aliases each count. See useLinkQuotaUsage.
  const linkCount = quotaUsage.data?.count ?? 0;
  const atLimit = linkCount >= limits.links;
  const limitHint = atLimit ? "Link limit reached: upgrade for more links" : undefined;

  const dialogs = useLinkDialogs(atLimit);

  const {
    search,
    domainFilter,
    sort,
    setSort,
    paged,
    filtered,
    totalPages,
    safePage,
    onSearchChange,
    onDomainFilterChange,
    setPage,
  } = useLinkFilter(links);

  /**
   * Answer the duplicate-destination prompt (#45).
   *
   * Both answers are the same create with one flag swapped, so they share a
   * call. The event name and the toast follow the flag, because merging an
   * address into an existing link and making a second link are different
   * things to have done.
   */
  const resolveDuplicate = (choice: { mergeIntoLinkId: string } | { forceSeparateLink: true }) => {
    if (!dialogs.sameDestination) return;
    const merging = "mergeIntoLinkId" in choice;
    create.mutate(
      { ...dialogs.sameDestination.input, ...choice },
      {
        onSuccess: () => {
          posthog.capture(merging ? "link_alias_created" : "link_created", {
            created_from_duplicate_destination: true,
          });
          dialogs.setSameDestination(null);
          dialogs.setEditorOpen(false);
          toast(merging ? "Address added to the existing link" : "Link created");
        },
        onError: (e) => toast(e.message, "error"),
      },
    );
  };

  if (!org) return <NoOrgState />;

  const onSave = buildOnSave({
    editing: dialogs.editing,
    create,
    update,
    toast,
    closeEditor: () => dialogs.setEditorOpen(false),
    onSaveError: () => dialogs.setShakeKey((k) => k + 1),
    onSameDestinationMatch: (input, matchedLinks) =>
      dialogs.setSameDestination({ input, matchedLinks }),
  });

  return (
    <div>
      <PageHeader
        title="Links"
        sub="Short links, UTM tagging and QR codes"
        action={
          <div className="flex items-center gap-3">
            <span className="text-xs tnum text-muted">
              {linkCount} / {limits.links} links
            </span>
            <Button
              variant="primary"
              onClick={dialogs.openCreate}
              disabled={atLimit}
              title={limitHint}
            >
              <Plus size={15} /> New link
            </Button>
          </div>
        }
      />

      <LinksListArea
        isLoading={links.isLoading}
        hasLinks={!!links.data?.length}
        atLimit={atLimit}
        limitHint={limitHint}
        onCreate={dialogs.openCreate}
      >
        <LinksToolbar
          search={search}
          onSearchChange={onSearchChange}
          domainFilter={domainFilter}
          onDomainFilterChange={onDomainFilterChange}
          domains={domains.data ?? []}
          filteredCount={filtered.length}
          totalCount={links.data?.length ?? 0}
        />
        <LinksTable
          orgId={orgId}
          paged={paged}
          navigate={navigate}
          onQrClick={dialogs.setQrLink}
          onEdit={dialogs.openEdit}
          onDelete={dialogs.setDeleting}
          onCreateAlias={dialogs.setAliasLink}
          sort={sort}
          onSort={setSort}
          totalPages={totalPages}
          currentPage={safePage}
          onPageChange={setPage}
        />
      </LinksListArea>

      <LinkDialogStack
        dialogs={dialogs}
        orgId={orgId}
        limits={limits}
        activeDomains={activeDomains}
        defaultDomainId={defaultDomainId}
        orgQr={orgQr}
        create={create}
        update={update}
        remove={remove}
        onSave={onSave}
        onResolveDuplicate={resolveDuplicate}
        toast={toast}
      />
    </div>
  );
}

/** Gates the links table area on load/empty state; renders its children
 * (toolbar + table) only once there's data to show. */
function LinksListArea({
  isLoading,
  hasLinks,
  atLimit,
  limitHint,
  onCreate,
  children,
}: {
  isLoading: boolean;
  hasLinks: boolean;
  atLimit: boolean;
  limitHint: string | undefined;
  onCreate: () => void;
  children: ReactNode;
}) {
  if (isLoading) return <TableSkeleton rows={5} />;
  if (!hasLinks) {
    return (
      <EmptyState
        title="No links yet"
        hint="Create your first short link. UTM parameters and a QR logo are optional."
        action={
          <Button variant="primary" onClick={onCreate} disabled={atLimit} title={limitHint}>
            <Plus size={15} /> New link
          </Button>
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
      confirmLabel="Delete"
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
  filteredCount,
  totalCount,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  domainFilter: string;
  onDomainFilterChange: (v: string) => void;
  domains: DomainDTO[];
  filteredCount: number;
  totalCount: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
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
      <span className="ms-auto text-xs text-muted tnum">
        {filteredCount} / {totalCount}
      </span>
    </div>
  );
}

/**
 * Every dialog the links page can open (#45).
 *
 * They are five separate concerns that happen to share a parent, and holding
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
  create,
  update,
  remove,
  onSave,
  onResolveDuplicate,
  toast,
}: {
  dialogs: ReturnType<typeof useLinkDialogs>;
  orgId: string;
  limits: ReturnType<typeof useOrgLimits>["limits"];
  activeDomains: ReturnType<typeof useOrgLimits>["activeDomains"];
  defaultDomainId: string | null;
  orgQr: ReturnType<typeof useOrgLimits>["orgQr"];
  create: ReturnType<typeof useLinkMutations>["create"];
  update: ReturnType<typeof useLinkMutations>["update"];
  remove: ReturnType<typeof useLinkMutations>["remove"];
  onSave: (data: LinkInput) => void;
  onResolveDuplicate: (choice: { mergeIntoLinkId: string } | { forceSeparateLink: true }) => void;
  toast: ReturnType<typeof useToast>;
}) {
  return (
    <>
      <LinkEditor
        open={dialogs.editorOpen}
        onOpenChange={dialogs.setEditorOpen}
        editingLink={dialogs.editing}
        busy={create.isPending || update.isPending}
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

      <SameDestinationDialog
        matchedLinks={dialogs.sameDestination?.matchedLinks ?? null}
        pending={create.isPending}
        onClose={() => dialogs.setSameDestination(null)}
        onAddToExisting={(matchedLink) => onResolveDuplicate({ mergeIntoLinkId: matchedLink.id })}
        onCreateSeparate={() => onResolveDuplicate({ forceSeparateLink: true })}
      />
    </>
  );
}
