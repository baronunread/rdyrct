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
import { PaidBadge, UpgradeDialog } from "./upgrade-dialog";
import { HrefLink } from "../lib/router-search";
import { cn } from "../ui/cn";
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
 * What a plan without `qrCustom` is in: offered the feature, or keeping
 * defaults it set before a downgrade (#162). Two situations, so two
 * sentences: telling an org that kept its logo to "upgrade to put your logo
 * on every QR code" describes the state it is already in.
 */
type Upsell = "offer" | "kept";

const UPSELL_LINE = {
  offer: "Your logo, colours and pattern on every new QR code.",
  kept: "These still apply to every QR code. Changing them needs a paid plan.",
} satisfies Record<Upsell, string>;

const QR_UPGRADE_BENEFITS = [
  "Your logo in every QR code",
  "Your colours and pattern",
  "Set once for the organization",
];

/**
 * The strip under the inert editor: one sentence, and the way to a plan for
 * the person who pays for it. Billing is the owner's, so anyone else is told
 * who can upgrade instead of being handed a button that upgrades their own
 * account and changes nothing here.
 */
function UpsellFooter({
  upsell,
  isOwner,
  onUpgrade,
}: {
  upsell: Upsell;
  isOwner: boolean;
  onUpgrade: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3">
      <p className="min-w-0 flex-1 basis-64 text-sm text-pretty text-muted">
        {UPSELL_LINE[upsell]}
        {!isOwner && " Only the owner can upgrade."}
      </p>
      {isOwner && (
        <Button variant="primary" size="sm" onClick={onUpgrade}>
          Upgrade
        </Button>
      )}
    </div>
  );
}

/**
 * The organization's QR defaults: the same rows as a link's QR editor, with
 * the preview and whatever `children` add under it in a side column (on a
 * phone, above the rows). With `upsell`, on a plan without `qrCustom`, the
 * rows are quiet and inert: the editor the plan would give, or the defaults
 * the org kept (#162), whose preview stays at full strength because it is
 * what every QR code still looks like.
 */
function QrDefaultsEditor({
  form,
  canEdit,
  upsell,
  children,
}: {
  form: ReturnType<typeof useQrDefaultsForm>;
  canEdit: boolean;
  upsell?: Upsell;
  children?: ReactNode;
}) {
  const [logoName, setLogoName] = useState<string | undefined>();
  return (
    <div
      className={cn(
        "grid overflow-hidden sm:grid-cols-[minmax(0,1fr)_220px]",
        upsell ? "rounded-t-xl" : "rounded-xl",
      )}
    >
      <div inert={!!upsell} className={cn("min-w-0 px-4 py-1 max-sm:order-last", upsell && QUIET)}>
        <QrEditorRows
          look={lookOf(form.values)}
          disabled={!canEdit && !upsell}
          logoName={logoName ?? "Your logo"}
          onChange={(patch, fileName) => {
            if (fileName) setLogoName(fileName);
            if (patch.qrLogo === "") setLogoName(undefined);
            form.apply(patch);
          }}
        />
      </div>
      <aside className="flex flex-col items-center gap-3 bg-bg p-4 max-sm:shadow-[inset_0_-1px_0_color-mix(in_oklab,var(--text)_8%,transparent)] sm:shadow-[inset_1px_0_0_color-mix(in_oklab,var(--text)_8%,transparent)]">
        <QrDefaultsPreview values={form.values} quiet={upsell === "offer"} />
        {children}
      </aside>
    </div>
  );
}

/** Quieter, for controls a plan shows but does not give. */
const QUIET = "opacity-55 saturate-[.6] select-none";

function QrDefaultsPreview({ values, quiet }: { values: QrValues; quiet: boolean }) {
  const linkHost = useLinkHost();
  return (
    <div
      inert={quiet}
      className={cn(
        "rounded-[14px] bg-white p-2.5 smooth-shadow-ring-sm [&_[role=img]]:rounded-none [&_[role=img]]:border-0",
        quiet && QUIET,
      )}
    >
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
 * The group on a plan without `qrCustom`: the badge by the title, the inert
 * editor, the strip under it, and the dialog its Upgrade opens. The plans
 * link and the button are the owner's, who pays for the org.
 */
function LockedQrDefaults({
  form,
  upsell,
  isOwner,
}: {
  form: ReturnType<typeof useQrDefaultsForm>;
  upsell: Upsell;
  isOwner: boolean;
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  return (
    <>
      <SettingsGroup
        title="QR code defaults"
        // An org being offered the feature has no defaults to describe.
        hint={upsell === "kept" ? QR_HINT : undefined}
        badge={<PaidBadge />}
        action={isOwner ? <SeePlansLink /> : undefined}
      >
        <QrDefaultsEditor form={form} canEdit={false} upsell={upsell} />
        <UpsellFooter upsell={upsell} isOwner={isOwner} onUpgrade={() => setUpgradeOpen(true)} />
      </SettingsGroup>
      <UpgradeDialog
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="QR code styles come with a paid plan"
        benefits={QR_UPGRADE_BENEFITS}
        unlockedBy="hobby"
      />
    </>
  );
}

function SeePlansLink() {
  return (
    <HrefLink
      href="/billing"
      className="text-xs font-medium text-accent [@media(hover:hover)]:hover:underline"
    >
      See plans
    </HrefLink>
  );
}

export function QrDefaultsCard() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const isPlatformAdmin = currentUser.data?.user.isAdmin;
  const isAdmin = canAdminOrg(isPlatformAdmin, org?.role, org?.locked);
  const hasQrCustom = org ? PLAN_LIMITS[org.plan].qrCustom : false;

  // SAFETY: Organization renders this card only once the current org has
  // loaded, so `org` is set here.
  const form = useQrDefaultsForm(orgId, org!);

  if (!hasQrCustom)
    return (
      <LockedQrDefaults
        form={form}
        // Defaults the org already set keep applying on a plan that no
        // longer allows new ones: shown as kept, rather than offered as a
        // feature they are visibly using (#162).
        upsell={hasAnyQrValue(form.values) ? "kept" : "offer"}
        isOwner={!!isPlatformAdmin || org?.role === "owner"}
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
