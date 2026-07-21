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
  "analytics",
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

export const EMPTY_UTM: UtmFields = {
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
};

/**
 * Resolve the UTM fields to store on a link. Params already present in the
 * destination URL win (they are what the redirect sends), then explicit
 * fields (an empty string clears), then the base (existing values on update).
 * Keeps the stored columns in sync with what buildDestination emits.
 */
export function resolveUtm(
  destination: string,
  fields: Partial<UtmFields>,
  base: UtmFields = EMPTY_UTM,
): UtmFields {
  let url: URL | null = null;
  try {
    url = new URL(destination);
  } catch {
    // invalid destination: fields and base decide
  }
  const out = { ...base };
  for (const [param, field] of UTM_KEYS) {
    const fromUrl = url?.searchParams.get(param)?.trim();
    if (fromUrl) {
      out[field] = fromUrl;
      continue;
    }
    const fromField = fields[field];
    if (fromField !== undefined) {
      out[field] = fromField.trim();
      continue;
    }
    out[field] = base[field];
  }
  return out;
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
import { QR_CORNER_STYLES, QR_DOT_STYLES } from "@/shared/types";

/**
 * Logo images live in R2; D1 rows store only the serving URL. Upload and
 * serving both go through /api/orgs/:orgId/qr-logo (org members only).
 */
export const qrLogoUrl = (orgId: string, file: string) =>
  `/api/orgs/${orgId}/qr-logo/${file}`;

const QR_LOGO_URL_RE =
  /^\/api\/orgs\/[A-Za-z0-9]+\/qr-logo\/[A-Za-z0-9]+\.[a-z0-9]+$/;

/** R2 key (`{orgId}/{file}`) for a serving URL, null for anything else. */
export function qrLogoKeyFromUrl(url: string): string | null {
  const m =
    /^\/api\/orgs\/([A-Za-z0-9]+)\/qr-logo\/([A-Za-z0-9]+\.[a-z0-9]+)$/.exec(
      url,
    );
  return m ? `${m[1]}/${m[2]}` : null;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Shared validation for org QR defaults and per-link overrides ('' = inherit). */
export function validateQrFields(
  fields: {
    qrLogo?: string;
    qrStyle?: string;
    qrColor?: string;
    qrCorner?: string;
    qrBg?: string;
    qrEyeColor?: string;
    qrLogoSize?: number | null;
  },
  orgId: string,
) {
  if (fields.qrLogo) {
    if (!QR_LOGO_URL_RE.test(fields.qrLogo))
      throw new HTTPException(400, { message: "Logo must be an uploaded image" });
    // A logo may only be referenced by the org that uploaded it.
    if (!fields.qrLogo.startsWith(`/api/orgs/${orgId}/`))
      throw new HTTPException(400, {
        message: "Logo must belong to this organization",
      });
  }
  if (
    fields.qrStyle &&
    !(QR_DOT_STYLES as readonly string[]).includes(fields.qrStyle)
  )
    throw new HTTPException(400, { message: "Unknown QR dot style" });
  if (
    fields.qrCorner &&
    !(QR_CORNER_STYLES as readonly string[]).includes(fields.qrCorner)
  )
    throw new HTTPException(400, { message: "Unknown QR corner style" });
  // 'transparent' is the one non-hex background we allow (see the QR preview).
  if (fields.qrBg && fields.qrBg !== "transparent" && !HEX_COLOR_RE.test(fields.qrBg))
    throw new HTTPException(400, {
      message: "QR background must be a hex color or 'transparent'",
    });
  for (const [key, val] of [
    ["QR color", fields.qrColor],
    ["QR eye color", fields.qrEyeColor],
  ] as const) {
    if (val && !HEX_COLOR_RE.test(val))
      throw new HTTPException(400, {
        message: `${key} must be a hex color like #17151f`,
      });
  }
  // null = inherit; otherwise a sane footprint ratio (bigger stops scanning).
  if (
    fields.qrLogoSize != null &&
    (!Number.isFinite(fields.qrLogoSize) ||
      fields.qrLogoSize < 0.2 ||
      fields.qrLogoSize > 0.7)
  )
    throw new HTTPException(400, {
      message: "QR logo size must be a ratio between 0.2 and 0.5",
    });
}
