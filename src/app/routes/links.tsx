import { useMemo, useState, type ChangeEvent } from "react";
import { useParams } from "react-router";
import {
  Plus,
  Copy,
  QrCode,
  Pencil,
  Trash2,
  ExternalLink,
  Lock,
  Info,
} from "lucide-react";
import { useLinks, useLinkMutations, useMe, useDomains } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { shortUrl, ApiError } from "../lib/api";
import {
  PLAN_LIMITS,
  QR_CORNER_STYLES,
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DEFAULT_CORNER,
  QR_DOT_STYLES,
  type DomainDTO,
  type LinkDTO,
  type LinkInput,
} from "@/shared/types";
import { Button, IconButton } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input, Select } from "../ui/field";
import { Table, Th, Td, EmptyState, PageHeader } from "../ui/misc";
import { TableSkeleton } from "../ui/skeleton";
import { Tooltip } from "../ui/tooltip";
import { useToast } from "../ui/toast";
import { QRPreview, QrLogoInput, QrColorField } from "../components/qr";

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
  domainId: null,
};

/** Org-level QR defaults a link inherits unless it overrides them. */
interface OrgQr {
  logo: string;
  style: string;
  color: string;
  corner: string;
  bg: string;
  eyeColor: string;
}

export function LinksPage() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const links = useLinks(orgId);
  const { create, update, remove } = useLinkMutations(orgId);
  const me = useMe();
  const toast = useToast();

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
  const orgQr: OrgQr = {
    logo: org?.qrLogo ?? "",
    style: org?.qrStyle ?? "",
    color: org?.qrColor ?? "",
    corner: org?.qrCorner ?? "",
    bg: org?.qrBg ?? "",
    eyeColor: org?.qrEyeColor ?? "",
  };

  const linkCount = links.data?.length ?? 0;
  const atLimit = linkCount >= limits.links;
  const limitHint = atLimit
    ? "Link limit reached: upgrade to Pro for more links"
    : undefined;

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<LinkDTO | null>(null);
  const [form, setForm] = useState<LinkInput>(emptyForm);
  const [qrLink, setQrLink] = useState<LinkDTO | null>(null);
  const [deleting, setDeleting] = useState<LinkDTO | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

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

  const copy = (link: LinkDTO) => {
    navigator.clipboard.writeText(shortUrl(link.slug, link.domain));
    toast("Copied to clipboard");
  };

  const noQrToast = () =>
    toast("QR codes are a Pro feature: upgrade in Settings", "error");

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
        <Table>
          <thead>
            <tr>
              <Th>Short link</Th>
              <Th>Destination</Th>
              <Th className="text-right">Clicks</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {links.data.map((link) => (
              <tr key={link.id} className="group">
                <Td>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-accent">
                      {link.domain ? `${link.domain}/${link.slug}` : `/${link.slug}`}
                    </span>
                    <button
                      onClick={() => copy(link)}
                      aria-label={`Copy ${shortUrl(link.slug, link.domain)}`}
                      className="cursor-pointer rounded p-1 text-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-text"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                  {link.title && (
                    <p className="text-xs text-muted">{link.title}</p>
                  )}
                </Td>
                <Td className="max-w-64">
                  <a
                    href={link.destination}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-muted hover:text-accent"
                  >
                    <span className="truncate">{link.destination}</span>
                    <ExternalLink size={12} className="shrink-0" />
                  </a>
                </Td>
                <Td className="tnum text-right">{link.clicks}</Td>
                <Td className="text-xs whitespace-nowrap text-muted">
                  {new Date(link.createdAt).toLocaleDateString()}
                </Td>
                <Td>
                  <div className="flex justify-end gap-0.5">
                    {limits.qr ? (
                      <IconButton label="QR code" onClick={() => setQrLink(link)}>
                        <QrCode size={15} />
                      </IconButton>
                    ) : (
                      <IconButton
                        label="QR codes are a Pro feature"
                        onClick={noQrToast}
                      >
                        <Lock size={15} />
                      </IconButton>
                    )}
                    <IconButton label="Edit" onClick={() => openEdit(link)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      danger
                      onClick={() => setDeleting(link)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
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

      {limits.qr && (
        <Dialog
          open={!!qrLink}
          onOpenChange={(o) => !o && setQrLink(null)}
          title={qrLink ? `QR · /${qrLink.slug}` : "QR"}
        >
          {qrLink && (
            <div className="flex flex-col items-center gap-2">
              <QRPreview
                url={shortUrl(qrLink.slug, qrLink.domain)}
                logo={qrLink.qrLogo || orgQr.logo || undefined}
                dotStyle={qrLink.qrStyle || orgQr.style}
                color={qrLink.qrColor || orgQr.color}
                corner={qrLink.qrCorner || orgQr.corner}
                eyeColor={qrLink.qrEyeColor || orgQr.eyeColor}
                bg={qrLink.qrBg || orgQr.bg}
                downloadName={`qr-${qrLink.slug}`}
              />
              <p className="text-xs text-muted">
                {shortUrl(qrLink.slug, qrLink.domain)}
              </p>
            </div>
          )}
        </Dialog>
      )}

      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete link"
      >
        {deleting && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              Delete <span className="font-bold text-accent">/{deleting.slug}</span>?
              The short link stops working immediately and its click history is
              removed.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(deleting.id, {
                    onSuccess: () => {
                      setDeleting(null);
                      toast("Link deleted");
                    },
                    onError: (e) => toast(e.message, "error"),
                  })
                }
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function LinkEditor({
  open,
  onOpenChange,
  form,
  setForm,
  editing,
  busy,
  onSave,
  activeDomains,
  qrEnabled,
  orgQr,
  shakeKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: LinkInput;
  setForm: (f: LinkInput) => void;
  editing: boolean;
  busy: boolean;
  onSave: () => void;
  activeDomains: DomainDTO[];
  qrEnabled: boolean;
  orgQr: OrgQr;
  shakeKey: number;
}) {
  const set = (key: keyof LinkInput) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  const selectedDomain =
    activeDomains.find((d) => d.id === form.domainId)?.hostname ?? null;

  // live preview URL: what the QR will encode
  const previewUrl = useMemo(
    () => shortUrl(form.slug?.trim() || "preview", selectedDomain),
    [form.slug, selectedDomain],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit link" : "New link"}
      wide
      shakeKey={shakeKey}
    >
      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Destination URL">
            <Input
              value={form.destination}
              onChange={set("destination")}
              placeholder="https://example.com/launch"
              autoFocus={!editing}
            />
          </Field>

          {activeDomains.length > 0 && (
            <Field label="Domain">
              <Select
                value={form.domainId ?? ""}
                onChange={(e) =>
                  setForm({ ...form, domainId: e.target.value || null })
                }
              >
                <option value="">shared: {window.location.host}</option>
                {activeDomains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.hostname}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Slug" hint="Leave empty for a random one">
              <Input
                value={form.slug ?? ""}
                onChange={set("slug")}
                placeholder="launch-2026"
              />
            </Field>
            <Field label="Title">
              <Input
                value={form.title ?? ""}
                onChange={set("title")}
                placeholder="Spring launch"
              />
            </Field>
          </div>

          <fieldset className="flex flex-1 flex-col rounded-lg border border-border p-3">
            <legend className="px-1 text-[11px] tracking-wider text-muted uppercase">
              UTM parameters
            </legend>
            <div className="grid flex-1 grid-cols-1 gap-3 content-between sm:grid-cols-2">
              <Field label="Source">
                <Input
                  value={form.utmSource ?? ""}
                  onChange={set("utmSource")}
                  placeholder="newsletter"
                />
              </Field>
              <Field label="Medium">
                <Input
                  value={form.utmMedium ?? ""}
                  onChange={set("utmMedium")}
                  placeholder="email"
                />
              </Field>
              <Field label="Campaign">
                <Input
                  value={form.utmCampaign ?? ""}
                  onChange={set("utmCampaign")}
                  placeholder="spring-launch"
                />
              </Field>
              <Field label="Term">
                <Input
                  value={form.utmTerm ?? ""}
                  onChange={set("utmTerm")}
                  placeholder="running-shoes"
                />
              </Field>
              <Field label="Content" className="sm:col-span-2">
                <Input
                  value={form.utmContent ?? ""}
                  onChange={set("utmContent")}
                  placeholder="ad-variant-a"
                />
              </Field>
            </div>
          </fieldset>
        </div>

        {qrEnabled ? (
          <div className="flex flex-col gap-4 sm:w-72">
            <p className="text-[11px] tracking-wider text-muted uppercase">
              QR code
            </p>
            <QRPreview
              url={previewUrl}
              logo={form.qrLogo || orgQr.logo || undefined}
              dotStyle={form.qrStyle || orgQr.style}
              color={form.qrColor || orgQr.color}
              corner={form.qrCorner || orgQr.corner}
              eyeColor={form.qrEyeColor || orgQr.eyeColor}
              bg={form.qrBg || orgQr.bg}
              size={192}
            />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Dots">
                <Select
                  value={form.qrStyle ?? ""}
                  onChange={(e) => setForm({ ...form, qrStyle: e.target.value })}
                >
                  <option value="">Org default</option>
                  {QR_DOT_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Corners">
                <Select
                  value={form.qrCorner ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, qrCorner: e.target.value })
                  }
                >
                  <option value="">Org default</option>
                  {QR_CORNER_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <QrColorField
                label="Dots"
                value={form.qrColor ?? ""}
                fallback={orgQr.color || QR_DEFAULT_COLOR}
                onChange={(v) => setForm({ ...form, qrColor: v })}
              />
              <QrColorField
                label="Eyes"
                value={form.qrEyeColor ?? ""}
                fallback={
                  form.qrColor ||
                  orgQr.eyeColor ||
                  orgQr.color ||
                  QR_DEFAULT_COLOR
                }
                onChange={(v) => setForm({ ...form, qrEyeColor: v })}
              />
            </div>

            <QrColorField
              label="Background"
              value={form.qrBg ?? ""}
              fallback={
                orgQr.bg && orgQr.bg !== "transparent" ? orgQr.bg : QR_DEFAULT_BG
              }
              allowTransparent
              onChange={(v) => setForm({ ...form, qrBg: v })}
            />

            <div>
              <span className="mb-1.5 flex items-center gap-1.5 text-[11px] tracking-wider text-muted uppercase">
                Logo
                <Tooltip content="Embedded in the center of the QR code. Use a small, square image with some breathing room so the code stays easy to scan. Leave empty to use your organization's default logo from Settings.">
                  <button
                    type="button"
                    aria-label="About QR logos"
                    className="cursor-pointer text-muted normal-case hover:text-text"
                  >
                    <Info size={13} />
                  </button>
                </Tooltip>
              </span>
              <QrLogoInput
                onLoad={(dataUri) => setForm({ ...form, qrLogo: dataUri })}
              />
              {form.qrLogo && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, qrLogo: "" })}
                  className="mt-1.5 cursor-pointer text-[11px] tracking-wider text-muted uppercase hover:text-text"
                >
                  Remove logo
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-center sm:w-72">
            <Lock size={20} className="text-muted" />
            <p className="text-xs text-muted">
              QR codes are a Pro feature: upgrade in Settings.
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={onSave}>
          {busy ? "…" : editing ? "Save changes" : "Create link"}
        </Button>
      </div>
    </Dialog>
  );
}
