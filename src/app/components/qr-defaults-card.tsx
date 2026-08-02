import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useCurrentUser } from "../lib/hooks";
import { useCurrentOrg } from "../lib/current-org";
import { api, shortUrl } from "../lib/api";
import {
  PLAN_LIMITS,
  QR_CORNER_STYLES,
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DOT_STYLES,
} from "@/shared/types";
import { Button } from "../ui/button";
import { Field } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Card } from "../ui/misc";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { Tooltip } from "../ui/tooltip";
import { QRPreview } from "./qr";
import { QrLogoInput } from "./qr-logo-input";
import { QrColorField } from "./qr-color-field";
import { orgQrFrom } from "../lib/org-qr";

interface QrDefaultsValues {
  qrStyle: string;
  qrColor: string;
  qrLogo: string;
  qrCorner: string;
  qrBg: string;
  qrEyeColor: string;
  qrLogoSize: string;
}

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
      toast("QR defaults saved");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingQr(false);
    }
  };

  return { values, setField, savingQr, save };
}

interface QrDefaultsFieldsProps {
  values: QrDefaultsValues;
  setField: <K extends keyof QrDefaultsValues>(key: K, value: QrDefaultsValues[K]) => void;
  isAdmin: boolean;
}

function QrShapeFields({ values, setField, isAdmin }: QrDefaultsFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Dot style">
        <MenuSelect
          label="Dot style"
          value={values.qrStyle}
          onChange={(v) => setField("qrStyle", v)}
          disabled={!isAdmin}
          options={[
            { value: "", label: "Rounded (default)" },
            ...QR_DOT_STYLES.flatMap((s) => (s === "rounded" ? [] : [{ value: s, label: s }])),
          ]}
        />
      </Field>
      <Field label="Corner style">
        <MenuSelect
          label="Corner style"
          value={values.qrCorner}
          onChange={(v) => setField("qrCorner", v)}
          disabled={!isAdmin}
          options={[
            { value: "", label: "Extra-rounded (default)" },
            ...QR_CORNER_STYLES.flatMap((s) =>
              s === "extra-rounded" ? [] : [{ value: s, label: s }],
            ),
          ]}
        />
      </Field>
    </div>
  );
}

function QrColorAndLogoFields({ values, setField, isAdmin }: QrDefaultsFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <QrColorField
          label="Dot color"
          value={values.qrColor}
          fallback={QR_DEFAULT_COLOR}
          onChange={(v) => setField("qrColor", v)}
          disabled={!isAdmin}
        />
        <QrColorField
          label="Eye color"
          value={values.qrEyeColor}
          fallback={values.qrColor || QR_DEFAULT_COLOR}
          onChange={(v) => setField("qrEyeColor", v)}
          disabled={!isAdmin}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <QrColorField
          label="Background"
          value={values.qrBg}
          fallback={QR_DEFAULT_BG}
          onChange={(v) => setField("qrBg", v)}
          disabled={!isAdmin}
          alpha
        />
        <Field
          label="Logo size"
          hint="How much of the QR code the logo covers. Bigger can hurt scannability"
        >
          <MenuSelect
            label="Logo size"
            value={values.qrLogoSize}
            onChange={(v) => setField("qrLogoSize", v)}
            disabled={!isAdmin}
            options={[
              { value: "", label: "Medium (default)" },
              { value: "0.25", label: "Small" },
              { value: "0.5", label: "Large" },
              { value: "0.65", label: "Extra large" },
            ]}
          />
        </Field>
      </div>
      <div>
        <span className="mb-1.5 flex items-center gap-1.5 text-2xs tracking-wider text-muted uppercase">
          Logo
          <Tooltip content="Embedded in the center of every QR code by default. Use a small, square image with some breathing room so the code stays easy to scan. A link can upload its own logo to override this.">
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
          value={values.qrLogo}
          disabled={!isAdmin}
          onLoad={(v) => setField("qrLogo", v)}
          onClear={isAdmin ? () => setField("qrLogo", "") : undefined}
        />
      </div>
    </div>
  );
}

function QrDefaultsFormFields({ values, setField, isAdmin }: QrDefaultsFieldsProps) {
  return (
    <div className="flex flex-col gap-6">
      <QrShapeFields values={values} setField={setField} isAdmin={isAdmin} />
      <QrColorAndLogoFields values={values} setField={setField} isAdmin={isAdmin} />
      <QRPreview
        url={shortUrl("preview")}
        logo={values.qrLogo || undefined}
        dotStyle={values.qrStyle}
        color={values.qrColor}
        corner={values.qrCorner}
        eyeColor={values.qrEyeColor}
        bg={values.qrBg}
        logoSize={values.qrLogoSize === "" ? undefined : Number(values.qrLogoSize)}
        size={160}
      />
    </div>
  );
}

/** Owner/admin (or platform admin) can edit; everyone else can only view. */
function canManageQrDefaults(
  isPlatformAdmin: boolean | undefined,
  role: "owner" | "admin" | "member" | undefined,
) {
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
  const me = useCurrentUser();
  const isAdmin = canManageQrDefaults(me.data?.user.isAdmin, org?.role);
  const hasQr = org ? PLAN_LIMITS[org.plan].qr : false;

  const { values, setField, savingQr, save } = useQrDefaultsForm(orgId, org!);

  return (
    <Card className="max-w-2xl">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-2xs tracking-wider text-muted uppercase">QR code defaults</p>
          <p className="mt-1 text-xs text-muted">
            Applied to every link's QR code unless the link overrides them.
          </p>
        </div>
        {!hasQr ? (
          <UpgradeQrPrompt />
        ) : (
          <div className="flex flex-col gap-6">
            <QrDefaultsFormFields values={values} setField={setField} isAdmin={isAdmin} />
            <SaveQrDefaultsAction isAdmin={isAdmin} savingQr={savingQr} save={save} />
          </div>
        )}
      </div>
    </Card>
  );
}
