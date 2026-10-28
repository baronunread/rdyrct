import { useState } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser, useLinkHost } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api, shortUrl } from "../lib/api";
import {
  PLAN_LIMITS,
  QR_CORNER_STYLES,
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DEFAULT_CORNER,
  QR_DEFAULT_LOGO_SIZE,
  QR_DOT_STYLES,
} from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import { Button } from "../ui/button";
import { SettingsGroup } from "../ui/settings-rows";
import { LockedPanel } from "./over-limit";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { QRPreview } from "./qr";
import { QrContrastNote, QrEditorRows, type QrLookValue, type QrPatch } from "./qr-pickers";
import { hasAnyQrValue, qrPreviewProps, type QrValues } from "../lib/qr-look";
import { orgQrFrom } from "../lib/org-qr";
import { canAdminOrg } from "../lib/org-limits";
import posthog from "../lib/posthog";

type Org = NonNullable<ReturnType<typeof useCurrentOrg>["org"]>;

const EMPTY: QrValues = {
  qrStyle: "",
  qrColor: "",
  qrLogo: "",
  qrCorner: "",
  qrBg: "",
  qrEyeColor: "",
  qrLogoSize: "",
};

/** The org's current QR defaults, as the string-only form the rows edit
 * (reuses orgQrFrom's already-tested `??` defaulting). */
function initialQrValues(org?: Org): QrValues {
  const qr = orgQrFrom(org);
  return {
    qrStyle: qr.style,
    qrColor: qr.color,
    qrLogo: qr.logo,
    qrCorner: qr.corner,
    qrBg: qr.bg,
    qrEyeColor: qr.eyeColor,
    qrLogoSize: qr.logoSize?.toString() ?? "",
  };
}

/** What the code is drawn with: every value concrete. */
function lookOf(v: QrValues): QrLookValue {
  const ink = v.qrColor || QR_DEFAULT_COLOR;
  return {
    dot: oneOf(QR_DOT_STYLES, v.qrStyle, "rounded"),
    corner: oneOf(QR_CORNER_STYLES, v.qrCorner, QR_DEFAULT_CORNER),
    dotColor: ink,
    cornerColor: v.qrEyeColor || ink,
    bg: v.qrBg || QR_DEFAULT_BG,
    logo: v.qrLogo,
    logoSize: v.qrLogoSize === "" ? QR_DEFAULT_LOGO_SIZE : Number(v.qrLogoSize),
  };
}

const same = (a: QrValues, b: QrValues) =>
  // SAFETY: both are QrValues, so they share one fixed set of keys.
  (Object.keys(a) as (keyof QrValues)[]).every((k) => a[k] === b[k]);

function useQrDefaultsForm(orgId: string, org: Org) {
  const qc = useQueryClient();
  const toast = useToast();
  const [saved, setSaved] = useState<QrValues>(() => initialQrValues(org));
  const [values, setValues] = useState<QrValues>(saved);
  const [savingQr, setSavingQr] = useState(false);

  const apply = (p: QrPatch) =>
    setValues((v) => ({
      qrStyle: p.qrStyle ?? v.qrStyle,
      qrCorner: p.qrCorner ?? v.qrCorner,
      qrColor: p.qrColor ?? v.qrColor,
      qrEyeColor: p.qrEyeColor ?? v.qrEyeColor,
      qrBg: p.qrBg ?? v.qrBg,
      qrLogo: p.qrLogo ?? v.qrLogo,
      qrLogoSize: p.qrLogoSize === undefined ? v.qrLogoSize : String(p.qrLogoSize),
    }));

  const save = async () => {
    setSavingQr(true);
    try {
      await api(`/orgs/${orgId}`, {
        method: "PATCH",
        body: {
          qrLogo: values.qrLogo,
          qrStyle: values.qrStyle,
          qrColor: values.qrColor,
          qrCorner: values.qrCorner,
          qrBg: values.qrBg,
          qrEyeColor: values.qrEyeColor,
          qrLogoSize: values.qrLogoSize === "" ? null : Number(values.qrLogoSize),
        },
      });
      setSaved(values);
      await qc.invalidateQueries({ queryKey: ["user"] });
      posthog.capture("qr_defaults_saved");
      toast("QR defaults saved");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSavingQr(false);
    }
  };

  return {
    values,
    apply,
    reset: () => setValues(EMPTY),
    dirty: !same(values, saved),
    savingQr,
    save,
  };
}

/**
 * What sits here on a plan without `qrCustom`.
 *
 * Two sentences, because they are two situations (#162). An org with no
 * defaults is being offered a feature. An org that already set some, and
 * downgraded, is keeping them: they still apply to every QR the org
 * generates, so telling that org to "upgrade to put your logo on every QR
 * code" describes the state it is already in.
 */
function UpgradeQrPrompt({ locked }: { locked: boolean }) {
  return locked ? (
    <LockedPanel
      bare
      title="Editing these needs a paid plan"
      reason="They still apply to every QR code this organization makes."
    />
  ) : (
    <LockedPanel
      bare
      title="QR code styles are a paid feature"
      reason="Put your logo, colors and pattern on every QR code."
    />
  );
}

/**
 * The organization's QR defaults: the same rows as a link's QR editor, with
 * the preview, its contrast check, Reset and Save in a side column (on a
 * phone, above the rows). Read-only on a plan that kept its defaults but may
 * no longer change them (#162), and for anyone who is not an admin.
 */
function QrDefaultsEditor({
  form,
  canEdit,
  isAdmin,
}: {
  form: ReturnType<typeof useQrDefaultsForm>;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const linkHost = useLinkHost();
  const [logoName, setLogoName] = useState<string | undefined>();
  const look = lookOf(form.values);
  return (
    <div className="grid overflow-hidden rounded-xl sm:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0 px-4 py-1 max-sm:order-last">
        <QrEditorRows
          look={look}
          disabled={!canEdit}
          logoName={logoName ?? "Your logo"}
          onChange={(patch, fileName) => {
            if (fileName) setLogoName(fileName);
            if (patch.qrLogo === "") setLogoName(undefined);
            form.apply(patch);
          }}
        />
      </div>
      <aside className="flex flex-col items-center gap-3 bg-bg p-4 max-sm:shadow-[inset_0_-1px_0_color-mix(in_oklab,var(--text)_8%,transparent)] sm:shadow-[inset_1px_0_0_color-mix(in_oklab,var(--text)_8%,transparent)]">
        <div className="rounded-[14px] bg-white p-2.5 smooth-shadow-ring-sm [&_[role=img]]:rounded-none [&_[role=img]]:border-0">
          <QRPreview
            url={shortUrl("preview", undefined, linkHost)}
            {...qrPreviewProps(form.values)}
            size={150}
          />
        </div>
        <QrContrastNote look={look} short />
        {canEdit ? (
          <div className="mt-auto flex w-full items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={form.reset}
              disabled={!hasAnyQrValue(form.values)}
              className="cursor-pointer text-xs text-muted underline decoration-from-font underline-offset-2 disabled:cursor-default disabled:no-underline disabled:opacity-50 enabled:[@media(hover:hover)]:hover:text-text"
            >
              Reset
            </button>
            <Button size="sm" onClick={form.save} disabled={!form.dirty || form.savingQr}>
              <BusyContent busy={form.savingQr}>Save</BusyContent>
            </Button>
          </div>
        ) : isAdmin ? null : (
          <p className="mt-auto text-center text-xs text-pretty text-muted">
            Only the owner and admins can change these.
          </p>
        )}
      </aside>
    </div>
  );
}

export function QrDefaultsCard() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const isAdmin = canAdminOrg(currentUser.data?.user.isAdmin, org?.role, org?.locked);
  const hasQrCustom = org ? PLAN_LIMITS[org.plan].qrCustom : false;

  // SAFETY: Organization renders this card only once the current org has
  // loaded, so `org` is set here.
  const form = useQrDefaultsForm(orgId, org!);
  // Defaults the org already set, which keep applying on a plan that no
  // longer allows new ones: shown, read-only, rather than replaced by an
  // upsell for the feature they are visibly using (#162).
  const hasQrDefaults = hasAnyQrValue(form.values);
  const canEdit = isAdmin && hasQrCustom;

  return (
    <SettingsGroup
      title="QR code defaults"
      hint="Every new QR code starts like this. Any link can change it."
    >
      {!hasQrCustom && <UpgradeQrPrompt locked={hasQrDefaults} />}
      {(hasQrCustom || hasQrDefaults) && (
        <QrDefaultsEditor form={form} canEdit={canEdit} isAdmin={isAdmin} />
      )}
    </SettingsGroup>
  );
}
