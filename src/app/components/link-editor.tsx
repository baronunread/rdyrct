import { useMemo, type ChangeEvent } from "react";
import { Link as RouterLink } from "react-router";
import { Lock, Info } from "lucide-react";
import { shortUrl } from "../lib/api";
import {
  QR_CORNER_STYLES,
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DOT_STYLES,
  type DomainDTO,
  type LinkInput,
} from "@/shared/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { Tooltip } from "../ui/tooltip";
import { QRPreview, QrLogoInput, QrColorField } from "./qr";

export interface OrgQr {
  logo: string;
  style: string;
  color: string;
  corner: string;
  bg: string;
  eyeColor: string;
  logoSize: number | null;
}

function QrCustomization({
  form,
  setForm,
  orgQr,
}: {
  form: LinkInput;
  setForm: (f: LinkInput) => void;
  orgQr: OrgQr;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-2xs tracking-wider text-muted uppercase">
        QR customization
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Dots">
          <MenuSelect
            label="Dots"
            value={form.qrStyle ?? ""}
            onChange={(v) => setForm({ ...form, qrStyle: v })}
            options={[
              { value: "", label: "Org default" },
              ...QR_DOT_STYLES.map((s) => ({ value: s, label: s })),
            ]}
          />
        </Field>
        <Field label="Corners">
          <MenuSelect
            label="Corners"
            value={form.qrCorner ?? ""}
            onChange={(v) => setForm({ ...form, qrCorner: v })}
            options={[
              { value: "", label: "Org default" },
              ...QR_CORNER_STYLES.map((s) => ({ value: s, label: s })),
            ]}
          />
        </Field>
        <QrColorField
          label="Dot color"
          value={form.qrColor ?? ""}
          fallback={orgQr.color || QR_DEFAULT_COLOR}
          onChange={(v) => setForm({ ...form, qrColor: v })}
        />
        <QrColorField
          label="Eye color"
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QrColorField
          label="Background"
          value={form.qrBg ?? ""}
          fallback={
            orgQr.bg && orgQr.bg !== "transparent" ? orgQr.bg : QR_DEFAULT_BG
          }
          allowTransparent
          onChange={(v) => setForm({ ...form, qrBg: v })}
        />
        <Field label="Logo size">
          <MenuSelect
            label="Logo size"
            value={form.qrLogoSize == null ? "" : String(form.qrLogoSize)}
            onChange={(v) =>
              setForm({
                ...form,
                qrLogoSize: v === "" ? null : Number(v),
              })
            }
            options={[
              { value: "", label: "Org default" },
              { value: "0.25", label: "Small" },
              { value: "0.35", label: "Medium" },
              { value: "0.5", label: "Large" },
              { value: "0.65", label: "Extra large" },
            ]}
          />
        </Field>
      </div>

      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-2xs tracking-wider text-muted uppercase">
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
          value={form.qrLogo ?? ""}
          onLoad={(dataUri) => setForm({ ...form, qrLogo: dataUri })}
          onClear={() => setForm({ ...form, qrLogo: "" })}
        />
      </div>
    </div>
  );
}

export function LinkEditor({
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
  const slugLocked = !form.domainId;

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
      <div className="flex flex-col gap-6">
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
                <MenuSelect
                  label="Domain"
                  value={form.domainId ?? ""}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      domainId: v || null,
                      ...(!v && !editing ? { slug: "" } : {}),
                    })
                  }
                  options={[
                    { value: "", label: `shared: ${window.location.host}` },
                    ...activeDomains.map((d) => ({
                      value: d.id,
                      label: d.hostname,
                    })),
                  ]}
                />
              </Field>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Slug"
                hint={
                  slugLocked ? (
                    <>
                      <RouterLink
                        to="/billing"
                        className="text-accent hover:underline"
                      >
                        Upgrade
                      </RouterLink>{" "}
                      for custom slugs.
                    </>
                  ) : (
                    "Leave empty for a random one"
                  )
                }
              >
                <Input
                  value={form.slug ?? ""}
                  onChange={set("slug")}
                  placeholder={slugLocked ? "random" : "launch-2026"}
                  disabled={slugLocked}
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
          </div>

          {qrEnabled ? (
            <div className="flex flex-col gap-2 sm:w-60">
              <p className="text-2xs tracking-wider text-muted uppercase">
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
                logoSize={
                  form.qrLogoSize != null
                    ? Number(form.qrLogoSize)
                    : orgQr.logoSize ?? undefined
                }
                size={192}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-center sm:w-60">
              <Lock size={20} className="text-muted" />
              <p className="text-xs text-muted">
                QR codes are a paid feature: upgrade in Billing.
              </p>
            </div>
          )}
        </div>

        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-2xs tracking-wider text-muted uppercase">
            UTM parameters
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <Field label="Content">
              <Input
                value={form.utmContent ?? ""}
                onChange={set("utmContent")}
                placeholder="ad-variant-a"
              />
            </Field>
          </div>
        </fieldset>

        {qrEnabled && (
          <QrCustomization form={form} setForm={setForm} orgQr={orgQr} />
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy} onClick={onSave}>
          {busy ? <Spinner /> : editing ? "Save changes" : "Create link"}
        </Button>
      </div>
    </Dialog>
  );
}
