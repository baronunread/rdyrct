import type { DotType } from "qr-code-styling";
import {
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DEFAULT_CORNER,
  QR_DEFAULT_LOGO_SIZE,
  QR_DOT_STYLES,
} from "@/shared/types";
import { oneOf } from "@/shared/lookup";

/** All of a QR code's appearance, already resolved to concrete values. */
export interface QrLook {
  dot: DotType;
  corner: string;
  ink: string;
  eye: string;
  bg: string;
  logo: string | undefined;
  logoSize: number;
}

/** Whether a resolved `bg` value has any transparency: the legacy
 * 'transparent' sentinel, or a hex color whose alpha byte is below 0xff. */
export function hasTransparency(bg: string): boolean {
  if (bg === "transparent") return true;
  const alpha = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/.exec(bg)?.[1];
  return alpha != null && parseInt(alpha, 16) < 255;
}

/** Resolves QRPreview's individual appearance props (each an override:
 * empty/undefined falls back to the built-in default) into a concrete QrLook. */
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

/**
 * Whether the logo has to be inlined by us rather than by the library.
 *
 * qr-code-styling fetches the image with XMLHttpRequest to turn it into a
 * data URI (its `saveAsBlob` step), which a browser refuses to do for a
 * `data:` or `blob:` URL. The XHR never completes, the promise it gates the
 * drawing on never resolves, and the result is an empty square: 439 paths
 * with no logo, zero with one. Switching that step off makes it use the URL
 * we already handed it, which is what a data URI is for.
 */
/** What qr-code-styling is told about the image it draws in the middle. */
interface QrImageOptions {
  margin: number;
  imageSize: number | undefined;
  saveAsBlob?: false;
}

export function imageOptionsFor(look: QrLook) {
  const inlineAlready = !!look.logo && /^(data|blob):/.test(look.logo);
  const options: QrImageOptions = { margin: 4, imageSize: look.logoSize };
  // Left off entirely otherwise, so the library keeps its own default, which
  // is what a logo it still has to fetch needs.
  if (inlineAlready) options.saveAsBlob = false;
  return options;
}

/** QRPreview's props, spread from the string values the fields hold. */
/** Every QR appearance value, as the strings the fields edit. An empty
 * string means "use the built-in default". */
export interface QrValues {
  qrStyle: string;
  qrColor: string;
  qrLogo: string;
  qrCorner: string;
  qrBg: string;
  qrEyeColor: string;
  qrLogoSize: string;
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
