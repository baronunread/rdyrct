import { useState } from "react";
import { errorMessage } from "@/app/lib/error-message";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api, shortUrl } from "../lib/api";
import { type OrgRole, PLAN_LIMITS } from "@/shared/types";
import { Button } from "../ui/button";
import { Card } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { QrColorAndLogoFields, QrPreviewSidebar, QrPatternFields } from "./qr-fields";
import { type QrValues } from "../lib/qr-look";
import { orgQrFrom } from "../lib/org-qr";
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

/** Owner/admin (or platform admin) can edit; everyone else can only view. */
function canManageQrDefaults(isPlatformAdmin: boolean | undefined, role: OrgRole | undefined) {
  return !!isPlatformAdmin || role === "owner" || role === "admin";
}

function UpgradeQrPrompt() {
  return (
    <p className="text-sm text-muted">
      QR customization is a paid feature.{" "}
      <Link to="/billing" className="text-accent hover:underline">
        Upgrade
      </Link>{" "}
      to put your logo and style on every QR code.
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

export function QrDefaultsCard() {
  const { org } = useCurrentOrg();
  const orgId = org?.id ?? "";
  const currentUser = useCurrentUser();
  const isAdmin = canManageQrDefaults(currentUser.data?.user.isAdmin, org?.role);
  const hasQrCustom = org ? PLAN_LIMITS[org.plan].qrCustom : false;

  const { values, setField, savingQr, save } = useQrDefaultsForm(orgId, org!);

  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-muted">QR code defaults</p>
          <p className="mt-1 text-xs text-muted">
            Applied to every link's QR code unless the link overrides them.
          </p>
        </div>
        {!hasQrCustom ? (
          <UpgradeQrPrompt />
        ) : (
          <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
            <QrPatternFields values={values} setField={setField} isAdmin={isAdmin} />
            <div className="order-last sm:order-none">
              <QrPreviewSidebar values={values} url={shortUrl("preview")} />
            </div>
            <QrColorAndLogoFields
              values={values}
              setField={setField}
              isAdmin={isAdmin}
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <SaveQrDefaultsAction isAdmin={isAdmin} savingQr={savingQr} save={save} />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
