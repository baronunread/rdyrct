// A scanner looks for dark modules on a light ground: too little contrast, or ink lighter
// than the background (an inverted code, which many camera apps refuse), breaks that.
// Contrast is the WCAG ratio, the luminance measure everybody already knows.

export type QrContrastLevel = "strong" | "fair" | "low" | "inverted" | "transparent";

export interface QrContrast {
  level: QrContrastLevel;
  ratio: number | null;
}

function parseHex(hex: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const STRONG = 4.5;
const FAIR = 3;

export function qrContrast({
  dots,
  corners,
  background,
}: {
  dots: string;
  corners: string;
  background: string;
}): QrContrast {
  const inks = [dots, corners].map(parseHex).filter((c) => c !== null);
  const inkL = inks.map(luminance);
  const bg = background === "transparent" ? null : parseHex(background);
  if (!bg || bg.a < 1) {
    // Nothing behind it to measure against. Dark ink works on whatever
    // light surface it is printed on; light ink needs a dark one.
    return { level: inkL.some((l) => l > 0.4) ? "low" : "transparent", ratio: null };
  }
  if (inks.length === 0) return { level: "strong", ratio: null };
  const bgL = luminance(bg);
  const worst = Math.min(...inkL.map((l) => ratio(l, bgL)));
  if (worst < FAIR) return { level: "low", ratio: worst };
  if (inkL.some((l) => l > bgL)) return { level: "inverted", ratio: worst };
  return { level: worst >= STRONG ? "strong" : "fair", ratio: worst };
}

export function toHex6(color: string): string {
  if (/^#[0-9a-fA-F]{6}/.test(color)) return color.slice(0, 7).toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(color))
    return `#${Array.from(color.slice(1), (c) => c + c).join("")}`.toLowerCase();
  return "#ffffff";
}
