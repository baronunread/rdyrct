import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { useLinks, useLinkMutations, useLinkQuotaUsage } from "../lib/hooks";
import { useOrgLimits } from "../lib/org-limits";
import { shortUrl, ApiError } from "../lib/api";
import { type DomainDTO, type LinkDTO, type LinkInput, type Sort } from "@/shared/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { EmptyState, PageHeader } from "../ui/misc";
import { TableSkeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { QRPreview } from "../components/qr";
import { NoOrgState } from "../components/no-org";
import { sortRows } from "../lib/sort";
import { LinkEditor } from "../components/link-editor";
import { resolveQrLook, type OrgQr } from "../lib/org-qr";
import { LinksTable } from "../components/links-table";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { SameDestinationDialog } from "../components/same-destination-dialog";
import { CreateAliasDialog } from "../components/create-alias-dialog";
import { withErrorToast } from "../lib/mutation-toast";

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

export function LinksPage() {
  const { org, orgId, limits, activeDomains, orgQr, domains } = useOrgLimits();
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

  const openCreate = () => {
    if (atLimit) return;
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (link: LinkDTO) => {
    setEditing(link);
    setEditorOpen(true);
  };

  const noQrToast = () => toast("QR codes are a paid feature: upgrade in Billing", "error");

  if (!org) return <NoOrgState />;

  const onSave = buildOnSave({
    editing,
    create,
    update,
    toast,
    closeEditor: () => setEditorOpen(false),
    onSaveError: () => setShakeKey((k) => k + 1),
    onSameDestinationMatch: (input, matchedLinks) => setSameDestination({ input, matchedLinks }),
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
            <Button variant="primary" onClick={openCreate} disabled={atLimit} title={limitHint}>
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
        onCreate={openCreate}
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
          limits={limits}
          onQrClick={setQrLink}
          onEdit={openEdit}
          onDelete={setDeleting}
          onCreateAlias={setAliasLink}
          sort={sort}
          onSort={setSort}
          totalPages={totalPages}
          currentPage={safePage}
          onPageChange={setPage}
          noQrToast={noQrToast}
        />
      </LinksListArea>

      <LinkEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editingLink={editing}
        busy={create.isPending || update.isPending}
        onSave={onSave}
        activeDomains={activeDomains}
        domainsAllowed={limits.domains > 0}
        qrEnabled={limits.qr}
        orgQr={orgQr}
        shakeKey={shakeKey}
      />

      {limits.qr && <QrLinkDialog link={qrLink} onClose={() => setQrLink(null)} orgQr={orgQr} />}

      <CreateAliasDialog
        orgId={orgId}
        link={aliasLink}
        onClose={() => setAliasLink(null)}
        activeDomains={activeDomains}
        domainsAllowed={limits.domains > 0}
      />

      <DeleteLinkDialog
        deleting={deleting}
        onClose={() => setDeleting(null)}
        remove={remove}
        toast={toast}
      />

      <SameDestinationDialog
        matchedLinks={sameDestination?.matchedLinks ?? null}
        pending={create.isPending}
        onClose={() => setSameDestination(null)}
        onAddToExisting={(matchedLink) => {
          if (!sameDestination) return;
          const { input } = sameDestination;
          create.mutate(
            { ...input, mergeIntoLinkId: matchedLink.id },
            {
              onSuccess: () => {
                setSameDestination(null);
                setEditorOpen(false);
                toast("Address added to the existing link");
              },
              onError: (e) => toast(e.message, "error"),
            },
          );
        }}
        onCreateSeparate={() => {
          if (!sameDestination) return;
          const { input } = sameDestination;
          create.mutate(
            { ...input, forceSeparateLink: true },
            {
              onSuccess: () => {
                setSameDestination(null);
                setEditorOpen(false);
                toast("Link created");
              },
              onError: (e) => toast(e.message, "error"),
            },
          );
        }}
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
    <div className="mb-4 flex flex-wrap items-center gap-2">
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
      <span className="ml-auto text-xs text-muted tnum">
        {filteredCount} / {totalCount}
      </span>
    </div>
  );
}

function QrLinkDialog({
  link,
  onClose,
  orgQr,
}: {
  link: LinkDTO | null;
  onClose: () => void;
  orgQr: OrgQr;
}) {
  return (
    <Dialog
      open={!!link}
      onOpenChange={(o) => !o && onClose()}
      title={link ? `QR · /${link.slug}` : "QR"}
    >
      {link && (
        <div className="flex flex-col items-center gap-2">
          <QRPreview
            url={shortUrl(link.slug, link.domain)}
            {...resolveQrLook(link, orgQr)}
            downloadName={`qr-${link.slug}`}
          />
          <p className="text-xs text-muted">{shortUrl(link.slug, link.domain)}</p>
        </div>
      )}
    </Dialog>
  );
}
