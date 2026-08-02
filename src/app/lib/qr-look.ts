import type { DotType } from "qr-code-styling";
import {
  QR_DEFAULT_BG,
  QR_DEFAULT_COLOR,
  QR_DEFAULT_CORNER,
  QR_DEFAULT_LOGO_SIZE,
} from "@/shared/types";

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
    dot: (dotStyle || "rounded") as DotType,
    corner: corner || QR_DEFAULT_CORNER,
    ink,
    eye: eyeColor || ink,
    bg: bg === "transparent" ? "transparent" : bg || QR_DEFAULT_BG,
    logo: logo || undefined,
    logoSize: logoSize || QR_DEFAULT_LOGO_SIZE,
  };
}
