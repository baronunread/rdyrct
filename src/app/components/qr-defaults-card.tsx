import { useState, type ReactNode } from "react";
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
import { PlanPickerDialog, useOwnerLabel } from "./plan-upsell";
import {
  keepPendingQrStyle,
  readPendingQrStyle,
  useSavePendingQrStyle,
} from "../lib/pending-qr-style";
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

/** `tried`: a style tried on Free before a checkout that did not finish
 * (lib/pending-qr-style.ts), so coming back shows it again, still unsaved. */
function useQrDefaultsForm(orgId: string, org: Org, tried: QrValues | null = null) {
  const qc = useQueryClient();
  const toast = useToast();
  const [saved, setSaved] = useState<QrValues>(() => initialQrValues(org));
  const [values, setValues] = useState<QrValues>(() => tried ?? saved);
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
    revert: () => setValues(saved),
    dirty: !same(values, saved),
    savingQr,
    save,
  };
}

/**
 * The organization's QR defaults: the same rows as a link's QR editor, with
 * the preview and whatever `children` add under it in a side column (on a
 * phone, above the rows). `localLogo` keeps a picked logo in the browser,
 * for a plan that may try one but not store it.
 */
function QrDefaultsEditor({
  form,
  canEdit,
  localLogo,
  caption,
  children,
}: {
  form: ReturnType<typeof useQrDefaultsForm>;
  canEdit: boolean;
  localLogo?: boolean;
  /** One quiet line under the preview. */
  caption?: string;
  children?: ReactNode;
}) {
  const [logoName, setLogoName] = useState<string | undefined>();
  return (
    <div className="grid overflow-hidden rounded-t-xl last:rounded-b-xl sm:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0 px-4 py-1 max-sm:order-last">
        <QrEditorRows
          look={lookOf(form.values)}
          disabled={!canEdit}
          localLogo={localLogo}
          logoName={logoName ?? "Your logo"}
          onChange={(patch, fileName) => {
            if (fileName) setLogoName(fileName);
            if (patch.qrLogo === "") setLogoName(undefined);
            form.apply(patch);
          }}
        />
      </div>
      <aside className="flex flex-col items-center gap-3 bg-bg p-4 max-sm:shadow-[inset_0_-1px_0_color-mix(in_oklab,var(--text)_8%,transparent)] sm:shadow-[inset_1px_0_0_color-mix(in_oklab,var(--text)_8%,transparent)]">
        <QrDefaultsPreview values={form.values} />
        {caption && (
          <p aria-live="polite" className="text-center text-xs text-muted">
            {caption}
          </p>
        )}
        {children}
      </aside>
    </div>
  );
}

/** The code on true white, whatever the theme, as it will be printed. */
function QrDefaultsPreview({ values }: { values: QrValues }) {
  const linkHost = useLinkHost();
  return (
    <div className="rounded-[14px] bg-white p-2.5 smooth-shadow-ring-sm [&_[role=img]]:rounded-none [&_[role=img]]:border-0">
      <QRPreview
        url={shortUrl("preview", undefined, linkHost)}
        {...qrPreviewProps(values)}
        size={150}
      />
    </div>
  );
}

/** Under the preview on a plan with `qrCustom`: the contrast check, then
 * Reset and Save for an admin, or who can change these for anyone else. */
function QrDefaultsActions({
  form,
  canEdit,
  isAdmin,
}: {
  form: ReturnType<typeof useQrDefaultsForm>;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  return (
    <>
      <QrContrastNote look={lookOf(form.values)} short />
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
    </>
  );
}

const QR_HINT = "Every new QR code starts like this. Any link can change it.";

/**
 * The words in the save row of a plan without `qrCustom`. "Kept" is an org
 * that set defaults on a paid plan and has since gone to Free (#162): they
 * still apply, so it is told that rather than offered what it already has.
 */
function tryRowCopy({
  kept,
  dirty,
  isOwner,
  owner,
}: {
  kept: boolean;
  dirty: boolean;
  isOwner: boolean;
  owner: string;
}) {
  const title = kept && !dirty ? "These still apply to every new QR code" : QR_TRY_TITLE;
  if (!isOwner) {
    const who = owner.charAt(0).toUpperCase() + owner.slice(1);
    return {
      title,
      line:
        kept && !dirty
          ? `Changing them needs a paid plan. ${who} can upgrade.`
          : `${who} can save this with a paid plan.`,
    };
  }
  if (dirty) return { title, line: "Not saved yet. Upgrade and it is kept." };
  return {
    title,
    line: kept ? "Changing them needs a paid plan." : "Try any style above. A paid plan saves it.",
  };
}

const QR_TRY_TITLE = "Every new QR code starts like this";

/** The plan picker, opened with a style tried (Save) or from the row alone. */
const PICKER_SAVE = {
  title: "Save this QR style",
  why: "Pick a plan. Your style is saved once you've paid.",
};
const PICKER_TRY = {
  title: "QR styles come with a paid plan",
  why: "Your logo, colours and dots on every new QR code.",
};

/**
 * The card on a plan without `qrCustom`: the real editor, fully usable, to
 * try a style on the live preview (a logo stays in the browser). Its last
 * row says nothing is saved and, for the owner who pays, opens the plan
 * picker; the style waits in sessionStorage through checkout and is saved
 * when the org comes back on a paid plan (lib/pending-qr-style.ts).
 */
function TryQrDefaults({
  form,
  orgId,
  kept,
  isOwner,
}: {
  form: ReturnType<typeof useQrDefaultsForm>;
  orgId: string;
  kept: boolean;
  isOwner: boolean;
}) {
  const [picker, setPicker] = useState(false);
  const owner = useOwnerLabel(orgId);
  const { dirty } = form;
  const copy = tryRowCopy({ kept, dirty, isOwner, owner });
  return (
    <>
      <SettingsGroup
        title="QR code defaults"
        action={<span className="text-xs text-muted">Saving comes with a paid plan</span>}
      >
        <QrDefaultsEditor
          form={form}
          canEdit
          localLogo
          caption={dirty ? "Preview, not saved" : "Preview"}
        >
          <QrContrastNote look={lookOf(form.values)} short />
        </QrDefaultsEditor>
        <div
          data-testid="qr-save-row"
          className="flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3"
        >
          {/* Keyed, so a change of state fades the new words in where the
              old ones were: same row, same height, nothing moves. */}
          <div key={`${dirty}`} className="swap-in min-w-0 flex-1 basis-64" aria-live="polite">
            <p className="text-sm font-medium">{copy.title}</p>
            <p className="mt-0.5 text-xs text-pretty text-muted">{copy.line}</p>
          </div>
          {isOwner && (
            <div key={`${dirty}-actions`} className="swap-in flex gap-2 max-sm:w-full">
              {dirty ? (
                <>
                  <Button variant="ghost" onClick={form.revert} className="max-sm:flex-1">
                    Reset
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => setPicker(true)}
                    className="max-sm:flex-1"
                  >
                    Upgrade to save
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setPicker(true)} className="max-sm:flex-1">
                  See plans
                </Button>
              )}
            </div>
          )}
        </div>
      </SettingsGroup>
      {isOwner && (
        <PlanPickerDialog
          open={picker}
          onClose={() => setPicker(false)}
          {...(dirty ? PICKER_SAVE : PICKER_TRY)}
          reason="qr"
          onCheckout={() => {
            if (dirty) keepPendingQrStyle({ orgId, values: form.values });
          }}
        />
      )}
    </>
  );
}

export function QrDefaultsCard() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const isPlatformAdmin = currentUser.data?.user.isAdmin;
  const isAdmin = canAdminOrg(isPlatformAdmin, org?.role, org?.locked);
  const hasQrCustom = org ? PLAN_LIMITS[org.plan].qrCustom : false;
  // A style tried before checkout lands here once the plan allows it.
  useSavePendingQrStyle();

  // SAFETY: Organization renders this card only once the current org has
  // loaded, so `org` is set here.
  const form = useQrDefaultsForm(orgId, org!, hasQrCustom ? null : readPendingQrStyle(orgId));

  if (!hasQrCustom)
    return (
      <TryQrDefaults
        form={form}
        orgId={orgId}
        // Defaults the org already set keep applying on a plan that no
        // longer allows new ones (#162).
        kept={hasAnyQrValue(initialQrValues(org))}
        isOwner={org?.role === "owner"}
      />
    );

  const canEdit = isAdmin;
  return (
    <SettingsGroup title="QR code defaults" hint={QR_HINT}>
      <QrDefaultsEditor form={form} canEdit={canEdit}>
        <QrDefaultsActions form={form} canEdit={canEdit} isAdmin={isAdmin} />
      </QrDefaultsEditor>
    </SettingsGroup>
  );
}
