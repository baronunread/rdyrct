const ID_ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // no lookalikes

function randomFrom(alphabet: string, len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export const uid = (len = 16) => randomFrom(ID_ALPHABET, len);
export const randomSlug = () => randomFrom(SLUG_ALPHABET, 7);
export const now = () => Date.now();

export const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// Paths the SPA owns at the top level; slugs may not shadow them. There is no
// /app prefix; every app page is a root keyword, so all of them are reserved.
export const RESERVED_SLUGS = new Set([
  "api",
  "app",
  "assets",
  // public
  "login",
  "signup",
  "onboarding",
  "reset-password",
  "invite",
  "privacy",
  "terms",
  // authenticated app tabs
  "dashboard",
  "links",
  "members",
  "billing",
  "domains",
  "settings",
  "admin",
]);

const UTM_KEYS = [
  ["utm_source", "utmSource"],
  ["utm_medium", "utmMedium"],
  ["utm_campaign", "utmCampaign"],
  ["utm_term", "utmTerm"],
  ["utm_content", "utmContent"],
] as const;

export interface UtmFields {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
}

/** Destination with the link's UTM params applied (existing params win). */
export function buildDestination(
  destination: string,
  utm: UtmFields,
): string {
  try {
    const url = new URL(destination);
    for (const [param, field] of UTM_KEYS) {
      const value = utm[field];
      if (value && !url.searchParams.has(param))
        url.searchParams.set(param, value);
    }
    return url.toString();
  } catch {
    return destination;
  }
}

export function deviceFromUA(ua: string): string {
  if (!ua) return "unknown";
  if (/bot|crawler|spider|curl|wget/i.test(ua)) return "bot";
  if (/mobile|iphone|android.+mobile/i.test(ua)) return "mobile";
  if (/ipad|tablet|android/i.test(ua)) return "tablet";
  return "desktop";
}

export function referrerHost(referrer: string): string {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname;
  } catch {
    return "";
  }
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/* ---------------- QR appearance validation ---------------- */

import { HTTPException } from "hono/http-exception";
import { QR_DOT_STYLES } from "@/shared/types";

/** data-URI QR logos are stored inline in D1, so keep them small. */
const MAX_QR_LOGO_BYTES = 96 * 1024;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Shared validation for org QR defaults and per-link overrides ('' = inherit). */
export function validateQrFields(fields: {
  qrLogo?: string;
  qrStyle?: string;
  qrColor?: string;
}) {
  if (fields.qrLogo) {
    if (!fields.qrLogo.startsWith("data:image/"))
      throw new HTTPException(400, { message: "Logo must be an image" });
    if (fields.qrLogo.length > MAX_QR_LOGO_BYTES * 1.37)
      throw new HTTPException(400, { message: "Logo too large (max ~96 KB)" });
  }
  if (
    fields.qrStyle &&
    !(QR_DOT_STYLES as readonly string[]).includes(fields.qrStyle)
  )
    throw new HTTPException(400, { message: "Unknown QR style" });
  if (fields.qrColor && !HEX_COLOR_RE.test(fields.qrColor))
    throw new HTTPException(400, {
      message: "QR color must be a hex color like #17151f",
    });
}
