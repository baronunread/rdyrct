import { useState, type ReactNode } from "react";
import { lookup } from "@/shared/lookup";
import { useNavigate } from "@tanstack/react-router";
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
import { LinksSkeleton } from "../components/skeletons";
import { useToast } from "../ui/toast";
import { NoOrgState } from "../components/no-org";
import { LinkEditor } from "../components/link-editor";
import { LinksTable } from "../components/links-table";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { SameDestinationDialog } from "../components/same-destination-dialog";
import { CreateAliasDialog } from "../components/create-alias-dialog";
import { LinkPreviewDialog } from "../components/link-preview-dialog";
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
  atLimit,
  limitHint,
  canWrite,
}: {
  list: ReturnType<typeof useLinkPage>;
  orgId: string;
  domains: DomainDTO[];
  navigate: (to: string) => void;
  dialogs: ReturnType<typeof useLinkDialogs>;
  atLimit: boolean;
  limitHint?: string;
  canWrite: boolean;
}) {
  return (
    <LinksListArea
      isLoading={list.links.isLoading}
      // An empty first page with nothing typed is an organization with no
      // links. An empty page with a search behind it is a search that found
      // nothing, and the toolbar has to stay on screen to be cleared.
      hasLinks={
        list.rows.length > 0 || !!list.search || list.domainFilter !== "all" || list.page > 0
      }
      atLimit={atLimit}
      limitHint={limitHint}
      onCreate={canWrite ? dialogs.openCreate : undefined}
    >
      <LinksToolbar
        search={list.search}
        onSearchChange={list.onSearchChange}
        domainFilter={list.domainFilter}
        onDomainFilterChange={list.onDomainFilterChange}
        domains={domains}
      />
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
  );
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
          // SAFETY: guarded by the same_destination_match code above, and the
          // route that sets that code attaches matchedLinks alongside it.
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
  const { create, update, remove } = useLinkMutations(orgId);
  const toast = useToast();
  const routerNavigate = useNavigate();
  const navigate = (to: string) => void routerNavigate({ href: to });

  // Links used against the plan cap, not the number of rows in the table: a
  // link plus its kept-forever aliases each count. See useLinkQuotaUsage.
  const linkCount = quotaUsage.data?.count ?? 0;
  const atLimit = linkCount >= limits.links;
  const overLimit = linkCount > limits.links;
  const limitHint = linkLimitHint(linkCount, limits.links);

  const dialogs = useLinkDialogs(atLimit);

  const list = useLinkPage(orgId);

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

  // The cached shell may know the organization before /user confirms the
  // current role and plan. Do not briefly offer a stale create control.
  if (currentUser.isLoading) return <LinksSkeleton />;
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
            <span className="tnum text-xs text-muted" title={limitHint}>
              {linkCount} / {limits.links} links
              {overLimit && " (over the limit)"}
            </span>
            {canWrite && (
              <Button
                variant="primary"
                onClick={dialogs.openCreate}
                disabled={atLimit}
                title={limitHint}
              >
                <Plus size={15} /> New link
              </Button>
            )}
          </div>
        }
      />

      <LinksBrowser
        list={list}
        orgId={orgId}
        domains={domains.data ?? []}
        navigate={navigate}
        dialogs={dialogs}
        atLimit={atLimit}
        limitHint={limitHint}
        canWrite={canWrite}
      />

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
  /** Undefined for a viewer, who has no way to make the empty state stop
   * being empty. The screen then explains rather than offering (#157). */
  onCreate?: () => void;
  children: ReactNode;
}) {
  if (isLoading) return <TableSkeleton rows={5} />;
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
            <Button variant="primary" onClick={onCreate} disabled={atLimit} title={limitHint}>
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
