/**
 * The QR appearance controls, shared by the organization's defaults card and
 * the free generator at /qr-code-generator.
 *
 * One implementation because they are the same controls: dot and corner
 * style, the three colors, logo size and the logo itself. What differs is
 * only what sits around them (a save button and a plan gate on one side,
 * a download and a link-shortening offer on the other) and where the logo
 * ends up: an org uploads it, the free page keeps it in the browser.
 */
import { Info } from "lucide-react";
import { QR_CORNER_STYLES, QR_DEFAULT_BG, QR_DEFAULT_COLOR, QR_DOT_STYLES } from "@/shared/types";
import { cn } from "../ui/cn";
import { Field } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { QRPreview } from "./qr";
import { qrPreviewProps, type QrValues } from "../lib/qr-look";
import { QrLogoInput } from "./qr-logo-input";
import { QrColorField } from "./qr-color-field";

type SetQrField = <K extends keyof QrValues>(key: K, value: QrValues[K]) => void;

interface QrFieldsProps {
  values: QrValues;
  setField: SetQrField;
  /** False renders the controls read-only, which is what a member sees on
   * the organization's defaults. The free page always passes true. */
  isAdmin: boolean;
  /** Keeps the logo local to the browser instead of uploading it to the
   * organization's bucket: the free generator has no organization. */
  localLogo?: boolean;
  className?: string;
}

export function QrShapeFields({ values, setField, isAdmin }: QrFieldsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
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

export function QrColorAndLogoFields({
  values,
  setField,
  isAdmin,
  localLogo,
  className,
}: QrFieldsProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
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
          tip="How much of the QR code the logo covers. A bigger logo hides more of the dots, and past a point a scanner cannot fill in what is missing."
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
              className="cursor-help text-muted normal-case hover:text-text"
            >
              <Info size={13} />
            </button>
          </Tooltip>
        </span>
        <QrLogoInput
          value={values.qrLogo}
          local={localLogo}
          disabled={!isAdmin}
          onLoad={(v) => setField("qrLogo", v)}
          onClear={isAdmin ? () => setField("qrLogo", "") : undefined}
        />
      </div>
    </div>
  );
}

/** Mirrors LinkEditor's QrPreviewSidebar (link-editor.tsx): beside the shape
 * fields on sm+ (via the caller's grid), moved after them (`order-last
 * sm:order-none`) on mobile, where it's more useful after the controls it's
 * previewing than pushed above them. */
export function QrPreviewSidebar({ values, url }: { values: QrValues; url: string }) {
  return (
    <div className="flex flex-col gap-2 sm:w-40">
      <p className="text-2xs tracking-wider text-muted uppercase">Preview</p>
      <QRPreview url={url} {...qrPreviewProps(values)} size={160} />
    </div>
  );
}
