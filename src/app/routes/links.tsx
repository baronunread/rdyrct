import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Copy, Check, QrCode, Lock } from "lucide-react";
import { useLinks, useLinkMutations, useCurrentUser, useDomains } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { shortUrl, ApiError } from "../lib/api";
import {
  PLAN_LIMITS,
  type DomainDTO,
  type LinkDTO,
  type LinkInput,
  type Sort,
} from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { EmptyState, PageHeader } from "../ui/misc";
import { TableSkeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { QRPreview } from "../components/qr";
import { NoOrgState } from "../components/no-org";
import { sortRows } from "../lib/sort";
import { LinkEditor, type OrgQr } from "../components/link-editor";
import { orgQrFrom } from "../lib/org-qr";
import { LinksTable } from "../components/links-table";

const emptyForm: LinkInput = {
  destination: "",
  slug: "",
  title: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
  qrLogo: "",
  qrStyle: "",
  qrColor: "",
  qrCorner: "",
  qrBg: "",
  qrEyeColor: "",
  qrLogoSize: null,
};

export function LinksPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const links = useLinks(orgId);
  const { create, update, remove } = useLinkMutations(orgId);
  const me = useCurrentUser();
  const toast = useToast();
  const navigate = useNavigate();

  const limits = PLAN_LIMITS[org?.plan ?? "free"];
  // GET /domains requires an admin+ role on the backend, only query it for
  // users who can actually see it, so members don't fire a doomed request.
  const canListDomains =
    !!me.data?.user.isAdmin || org?.role === "owner" || org?.role === "admin";
  const domains = useDomains(orgId, canListDomains);
  const activeDomains = useMemo(
    () => (domains.data ?? []).filter((d) => d.status === "active"),
    [domains.data],
  );
  const orgQr = orgQrFrom(org);

  const linkCount = links.data?.length ?? 0;
  const atLimit = linkCount >= limits.links;
  const limitHint = atLimit
    ? "Link limit reached: upgrade for more links"
    : undefined;

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LinkDTO | null>(null);
  const [form, setForm] = useState<LinkInput>(emptyForm);
  const [qrLink, setQrLink] = useState<LinkDTO | null>(null);
  const [deleting, setDeleting] = useState<LinkDTO | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  // Search, filter, sort, pagination
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("all");
  const [sort, setSort] = useState<Sort>({ key: "createdAt", dir: -1 });
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

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

  const openCreate = () => {
    if (atLimit) return;
    setEditing(null);
    setForm(emptyForm);
    setEditorOpen(true);
  };
  const openEdit = (link: LinkDTO) => {
    setEditing(link);
    setForm({ ...link });
    setEditorOpen(true);
  };

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = async (link: LinkDTO) => {
    try {
      await navigator.clipboard.writeText(shortUrl(link.slug, link.domain));
      toast("Copied to clipboard");
      setCopiedId(link.id);
      window.setTimeout(() => setCopiedId(null), 1400);
    } catch {
      toast("Could not copy to clipboard", "error");
    }
  };

  const noQrToast = () =>
    toast("QR codes are a paid feature: upgrade in Billing", "error");

  if (!org) return <NoOrgState />;

  const save = () => {
    const done = {
      onSuccess: () => {
        setEditorOpen(false);
        toast(editing ? "Link updated" : "Link created");
      },
      onError: (e: Error) => {
        // slug clashes shake the dialog (kept open) and toast the reason;
        // everything else just toasts
        if (e instanceof ApiError && e.code === "slug_taken")
          setShakeKey((k) => k + 1);
        toast(e.message, "error");
      },
    };
    if (editing) update.mutate({ id: editing.id, ...form }, done);
    else create.mutate(form, done);
  };

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
              onClick={openCreate}
              disabled={atLimit}
              title={limitHint}
            >
              <Plus size={15} /> New link
            </Button>
          </div>
        }
      />

      {links.isLoading ? (
        <TableSkeleton rows={5} />
      ) : !links.data?.length ? (
        <EmptyState
          title="No links yet"
          hint="Create your first short link. UTM parameters and a QR logo are optional."
          action={
            <Button
              variant="primary"
              onClick={openCreate}
              disabled={atLimit}
              title={limitHint}
            >
              <Plus size={15} /> New link
            </Button>
          }
        />
      ) : (
        <>
          <LinksToolbar
            search={search}
            onSearchChange={(v) => { setSearch(v); setPage(0); }}
            domainFilter={domainFilter}
            onDomainFilterChange={(v) => { setDomainFilter(v); setPage(0); }}
            domains={domains.data ?? []}
            filteredCount={filtered.length}
            totalCount={links.data.length}
          />
          <LinksTable
            paged={paged}
            navigate={navigate}
            copy={copy}
            copiedId={copiedId}
            limits={limits}
            onQrClick={setQrLink}
            onEdit={openEdit}
            onDelete={setDeleting}
            sort={sort}
            onSort={setSort}
            totalPages={totalPages}
            currentPage={safePage}
            onPageChange={setPage}
            noQrToast={noQrToast}
          />
        </>
      )}

      <LinkEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        form={form}
        setForm={setForm}
        editing={!!editing}
        busy={create.isPending || update.isPending}
        onSave={save}
        activeDomains={activeDomains}
        qrEnabled={limits.qr}
        orgQr={orgQr}
        shakeKey={shakeKey}
      />

      {limits.qr && <QrLinkDialog link={qrLink} onClose={() => setQrLink(null)} orgQr={orgQr} />}

      <DeleteLinkDialog
        link={deleting}
        onClose={() => setDeleting(null)}
        remove={remove}
        notify={toast}
      />
    </div>
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
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()} title={link ? `QR · /${link.slug}` : "QR"}>
      {link && (
        <div className="flex flex-col items-center gap-2">
          <QRPreview
            url={shortUrl(link.slug, link.domain)}
            logo={link.qrLogo || orgQr.logo || undefined}
            dotStyle={link.qrStyle || orgQr.style}
            color={link.qrColor || orgQr.color}
            corner={link.qrCorner || orgQr.corner}
            eyeColor={link.qrEyeColor || orgQr.eyeColor}
            bg={link.qrBg || orgQr.bg}
            logoSize={orgQr.logoSize ?? undefined}
            downloadName={`qr-${link.slug}`}
          />
          <p className="text-xs text-muted">
            {shortUrl(link.slug, link.domain)}
          </p>
        </div>
      )}
    </Dialog>
  );
}

function DeleteLinkDialog({
  link,
  onClose,
  remove,
  notify,
}: {
  link: LinkDTO | null;
  onClose: () => void;
  remove: { mutate: (id: string, opts: { onSuccess?: () => void; onError?: (e: Error) => void }) => void; isPending: boolean };
  notify: (msg: string, type?: "error") => void;
}) {
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()} title="Delete link">
      {link && (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            Delete <span className="font-bold text-accent">/{link.slug}</span>?
            The short link stops working immediately and its click history is
            removed.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(link.id, {
                  onSuccess: () => {
                    notify("Link deleted");
                    onClose();
                  },
                  onError: (e) => notify(e.message, "error"),
                })
              }
            >
              Delete
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
