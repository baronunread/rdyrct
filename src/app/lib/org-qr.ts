import { QR_DEFAULT_BG, QR_DEFAULT_COLOR, type QrOverrides } from "@/shared/types";

/** A link's or org's QR appearance, already resolved to concrete override
 * values (each field "" means "no override: inherit the built-in default"). */
export interface OrgQr {
  logo: string;
  style: string;
  color: string;
  corner: string;
  bg: string;
  eyeColor: string;
  logoSize: number | null;
}

/** Map a UserOrg's QR defaults into the OrgQr shape the editors consume. */
export function orgQrFrom(org?: Partial<QrOverrides> | null): OrgQr {
  return {
    logo: org?.qrLogo ?? "",
    style: org?.qrStyle ?? "",
    color: org?.qrColor ?? "",
    corner: org?.qrCorner ?? "",
    bg: org?.qrBg ?? "",
    eyeColor: org?.qrEyeColor ?? "",
    logoSize: org?.qrLogoSize ?? null,
  };
}

/** A link's QR overrides resolved over its org's defaults: what the code
 * actually renders with, ready to pass straight to QRPreview. */
export function resolveQrLook(form: Partial<QrOverrides>, orgQr: OrgQr) {
  return {
    logo: form.qrLogo || orgQr.logo || undefined,
    dotStyle: form.qrStyle || orgQr.style,
    color: form.qrColor || orgQr.color,
    corner: form.qrCorner || orgQr.corner,
    eyeColor: form.qrEyeColor || orgQr.eyeColor,
    bg: form.qrBg || orgQr.bg,
    logoSize: form.qrLogoSize != null ? Number(form.qrLogoSize) : (orgQr.logoSize ?? undefined),
  };
}

/** What each QR field falls back to when a link leaves it unset (shown as
 * the color swatch's placeholder while the field reads "Org default"). */
export function qrFallbacks(form: Partial<QrOverrides>, orgQr: OrgQr) {
  return {
    dotColor: orgQr.color || QR_DEFAULT_COLOR,
    eyeColor: form.qrColor || orgQr.eyeColor || orgQr.color || QR_DEFAULT_COLOR,
    bg: orgQr.bg && orgQr.bg !== "transparent" ? orgQr.bg : QR_DEFAULT_BG,
  };
}
