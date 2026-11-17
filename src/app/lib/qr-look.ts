import type { DotType } from "qr-code-styling";
import {
  QR_CORNER_STYLES,
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DEFAULT_CORNER,
  QR_DEFAULT_LOGO_SIZE,
  QR_DOT_STYLES,
} from "@/shared/types";
import { oneOf } from "@/shared/lookup";

export interface QrLook {
  dot: DotType;
  corner: string;
  ink: string;
  eye: string;
  bg: string;
  logo: string | undefined;
  logoSize: number;
}

export function hasTransparency(bg: string): boolean {
  if (bg === "transparent") return true;
  const alpha = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/.exec(bg)?.[1];
  return alpha != null && parseInt(alpha, 16) < 255;
}

export function resolveLook({
  logo,
  dotStyle,
  color,
  corner,
  eyeColor,
  bg,
  logoSize,
}: {
  logo?: string;
  dotStyle?: string;
  color?: string;
  corner?: string;
  eyeColor?: string;
  bg?: string;
  logoSize?: number;
}): QrLook {
  const ink = color || QR_DEFAULT_COLOR;
  return {
    dot: oneOf(QR_DOT_STYLES, dotStyle ?? "", "rounded"),
    corner: corner || QR_DEFAULT_CORNER,
    ink,
    eye: eyeColor || ink,
    bg: bg === "transparent" ? "transparent" : bg || QR_DEFAULT_BG,
    logo: logo || undefined,
    logoSize: logoSize || QR_DEFAULT_LOGO_SIZE,
  };
}

// qr-code-styling fetches the image by XMLHttpRequest, which a browser refuses for `data:`
// and `blob:` URLs: the promise never resolves and the code draws empty. Switching that
// step off makes it use the URL we handed it.
interface QrImageOptions {
  margin: number;
  imageSize: number | undefined;
  saveAsBlob?: false;
}

// "H" costs size: the same link is 33 modules a side at "H" and 25 at "M". Only a logo
// needs "H"'s 30% recovery; "M" still covers print wear.
export const eccFor = (look: QrLook) => (look.logo ? "H" : "M");

export function imageOptionsFor(look: QrLook) {
  const inlineAlready = !!look.logo && /^(data|blob):/.test(look.logo);
  const options: QrImageOptions = { margin: 4, imageSize: look.logoSize };
  // Left off otherwise so the library keeps its default, which a logo it still has to fetch needs.
  if (inlineAlready) options.saveAsBlob = false;
  return options;
}

export interface QrValues {
  qrStyle: string;
  qrColor: string;
  qrLogo: string;
  qrCorner: string;
  qrBg: string;
  qrEyeColor: string;
  qrLogoSize: string;
}

// Every field is a string and "" means unset, `qrLogoSize` included. Comparing that one
// against null is always true: an org that set nothing was told its defaults were locked.
export function hasAnyQrValue(values: QrValues): boolean {
  return Object.values(values).some((v) => v !== "");
}

export interface QrLookValue {
  dot: (typeof QR_DOT_STYLES)[number];
  corner: (typeof QR_CORNER_STYLES)[number];
  dotColor: string;
  cornerColor: string;
  bg: string;
  logo: string;
  logoSize: number;
}

export type QrPatch = Partial<{
  qrStyle: string;
  qrCorner: string;
  qrColor: string;
  qrEyeColor: string;
  qrBg: string;
  qrLogo: string;
  qrLogoSize: number;
}>;

export function qrLookOf(v: QrValues): QrLookValue {
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

export function applyQrPatch(v: QrValues, p: QrPatch): QrValues {
  return {
    qrStyle: p.qrStyle ?? v.qrStyle,
    qrCorner: p.qrCorner ?? v.qrCorner,
    qrColor: p.qrColor ?? v.qrColor,
    qrEyeColor: p.qrEyeColor ?? v.qrEyeColor,
    qrBg: p.qrBg ?? v.qrBg,
    qrLogo: p.qrLogo ?? v.qrLogo,
    qrLogoSize: p.qrLogoSize === undefined ? v.qrLogoSize : String(p.qrLogoSize),
  };
}

export function qrPreviewProps(values: QrValues) {
  return {
    logo: values.qrLogo || undefined,
    dotStyle: values.qrStyle,
    color: values.qrColor,
    corner: values.qrCorner,
    eyeColor: values.qrEyeColor,
    bg: values.qrBg,
    logoSize: values.qrLogoSize === "" ? undefined : Number(values.qrLogoSize),
  };
}
