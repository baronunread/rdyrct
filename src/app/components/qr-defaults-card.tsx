import { useState } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api, shortUrl } from "../lib/api";
import { PLAN_LIMITS } from "@/shared/types";
import { Button } from "../ui/button";
import { Card } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { QrColorAndLogoFields, QrPreviewSidebar, QrPatternFields } from "./qr-fields";
import { hasAnyQrValue, type QrValues } from "../lib/qr-look";
import { orgQrFrom } from "../lib/org-qr";
import { canAdminOrg } from "../lib/org-limits";
import posthog from "../lib/posthog";

type QrDefaultsValues = QrValues;

/** The org's current QR defaults, as the string-only form the settings
 * fields edit (reuses orgQrFrom's already-tested `??` defaulting). */
function initialQrValues(
  org?: NonNullable<ReturnType<typeof useCurrentOrg>["org"]>,
): QrDefaultsValues {
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

function useQrDefaultsForm(
  orgId: string,
  org: NonNullable<ReturnType<typeof useCurrentOrg>["org"]>,
) {
  const qc = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<QrDefaultsValues>(() => initialQrValues(org));
  const [savingQr, setSavingQr] = useState(false);

  const setField = <K extends keyof QrDefaultsValues>(key: K, value: QrDefaultsValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

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
      await qc.invalidateQueries({ queryKey: ["user"] });
      posthog.capture("qr_defaults_saved");
      toast("QR defaults saved");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSavingQr(false);
    }
  };

  return { values, setField, savingQr, save };
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
  return (
    <p className="max-w-prose text-sm text-muted">
      {locked
        ? "These defaults still apply to every QR code this organization makes. Changing them needs a paid plan. "
        : "Changing how QR codes look needs a paid plan. "}
      <Link to="/billing" className="text-accent hover:underline">
        Upgrade
      </Link>{" "}
      {locked ? "to edit them again." : "to put your logo and style on every QR code."}
    </p>
  );
}

function SaveQrDefaultsAction({
  isAdmin,
  savingQr,
  save,
}: {
  isAdmin: boolean;
  savingQr: boolean;
  save: () => void;
}) {
  if (!isAdmin) {
    return (
      <p className="text-xs text-muted">Only the owner and admins can change these settings.</p>
    );
  }
  return (
    <div>
      <Button variant="primary" onClick={save} disabled={savingQr}>
        <BusyContent busy={savingQr}>Save QR defaults</BusyContent>
      </Button>
    </div>
  );
}

/** The editor grid, or the same grid read-only on a plan that kept its
 * defaults but may no longer change them (#162). */
function QrDefaultsFields({
  values,
  setField,
  canEdit,
  savingQr,
  save,
}: {
  values: QrDefaultsValues;
  setField: ReturnType<typeof useQrDefaultsForm>["setField"];
  canEdit: boolean;
  savingQr: boolean;
  save: () => void;
}) {
  return (
    <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
      <QrPatternFields values={values} setField={setField} isAdmin={canEdit} />
      <div className="order-last sm:order-none">
        <QrPreviewSidebar values={values} url={shortUrl("preview")} />
      </div>
      <QrColorAndLogoFields
        values={values}
        setField={setField}
        isAdmin={canEdit}
        className="sm:col-span-2"
      />
      {canEdit && (
        <div className="sm:col-span-2">
          <SaveQrDefaultsAction isAdmin={canEdit} savingQr={savingQr} save={save} />
        </div>
      )}
    </div>
  );
}

export function QrDefaultsCard() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const isAdmin = canAdminOrg(currentUser.data?.user.isAdmin, org?.role, org?.locked);
  const hasQrCustom = org ? PLAN_LIMITS[org.plan].qrCustom : false;

  const { values, setField, savingQr, save } = useQrDefaultsForm(orgId, org!);
  // Defaults the org already set, which keep applying on a plan that no
  // longer allows new ones: shown, read-only, rather than replaced by an
  // upsell for the feature they are visibly using (#162).
  const hasQrDefaults = hasAnyQrValue(values);
  const canEdit = isAdmin && hasQrCustom;

  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-muted">QR code defaults</p>
          <p className="mt-1 text-xs text-muted">
            Applied to every link's QR code unless the link overrides them.
          </p>
        </div>
        {!hasQrCustom && <UpgradeQrPrompt locked={hasQrDefaults} />}
        {(hasQrCustom || hasQrDefaults) && (
          <QrDefaultsFields
            values={values}
            setField={setField}
            canEdit={canEdit}
            savingQr={savingQr}
            save={save}
          />
        )}
      </div>
    </Card>
  );
}
