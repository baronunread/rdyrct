const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // no lookalikes

function randomFrom(alphabet: string, len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export const uid = (len = 16) => randomFrom(ID_ALPHABET, len);
export const randomSlug = () => randomFrom(SLUG_ALPHABET, 7);

// A renamed custom-domain address keeps working for exactly this long before
// the daily sweep (storage.ts's sweepExpiredAliases) retires it.
export const ALIAS_TTL_MS = 48 * 60 * 60 * 1000;

export const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// Paths the SPA owns at the top level; slugs may not shadow them. There is no
// /app prefix; every app page is a root keyword, so all of them are reserved.
export const RESERVED_SLUGS = new Set([
  "api",
  "app",
  "assets",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  // public
  "login",
  "signup",
  "onboarding",
  "reset-password",
  "invite",
  "privacy",
  "terms",
  "blog",
  "qr-code-generator",
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

/**
 * Strip utm_* params out of a destination, leaving every other query param
 * alone. Called right after resolveUtm has already pulled any of them into
 * the UTM columns, so nothing is lost: `destination` stays the bare link,
 * buildDestination re-applies the stored columns at redirect time.
 */
export function stripUtmParams(destination: string): string {
  try {
    const url = new URL(destination);
    for (const [param] of UTM_KEYS) url.searchParams.delete(param);
    return url.toString();
  } catch {
    return destination;
  }
}

/** Destination with the link's UTM params applied (existing params win). */
export function buildDestination(destination: string, utm: UtmFields): string {
  try {
    const url = new URL(destination);
    for (const [param, field] of UTM_KEYS) {
      const value = utm[field];
      if (value && !url.searchParams.has(param)) url.searchParams.set(param, value);
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

// Throwaway inbox providers. A signup from one of these is worth spotting in
// the admin user list, so support can watch for abuse patterns. This is a
// deliberately short, hand-picked list of the well-known ones, not a 50k-entry
// blocklist: it is display-only and never blocks a signup, so a miss costs
// nothing. Mainstream regional providers stay OFF: qq.com (Tencent) reads as
// unfamiliar, not throwaway, and its users are real. Keep entries lowercase.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "yopmail.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "temp-mail.org",
  "tempmail.com",
  "throwawaymail.com",
  "getnada.com",
  "trashmail.com",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "mohmal.com",
  "emailondeck.com",
  "moakt.com",
]);

/** True when an email's domain is a known throwaway inbox provider. */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/**
 * The longest hostname the DNS spec allows. A referrer longer than this is
 * not a hostname we failed to shorten, it's junk, so it stores as "".
 */
const REFERRER_MAX_LENGTH = 253;

/** The longest single dot-separated label DNS allows. */
const REFERRER_MAX_LABEL_LENGTH = 63;

/**
 * What a stored referrer may look like: lowercase letters, digits, hyphens,
 * and the dots between labels. Unicode domains arrive from `URL.hostname`
 * already punycoded (`xn--…`), so they fit without an exception.
 *
 * Migration 0016 applies the same shape to the rows written before this
 * existed. Keep the two in step: a value one accepts and the other clears
 * would leave the table holding referrers ingestion would now refuse.
 */
const REFERRER_ALLOWED_CHARS = /^[a-z0-9.-]+$/;

/**
 * True when `host` is shaped like a name we could report on: within the DNS
 * length limits, no empty labels (so no leading, trailing, or doubled dot),
 * and at least one dot, which rules out bare words like "localhost".
 */
function isReportableHost(host: string): boolean {
  if (host.length > REFERRER_MAX_LENGTH) return false;
  if (!REFERRER_ALLOWED_CHARS.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0 && label.length <= REFERRER_MAX_LABEL_LENGTH);
}

/**
 * What a click may remember about where it came from: a bare lowercase
 * hostname, or "" for direct and for anything we can't read (see issue #20).
 *
 * A raw Referer header is a whole URL, and other people's URLs carry search
 * terms, session tokens, and account identifiers in their paths and query
 * strings. None of that is ours to keep, and storing it would contradict the
 * promise the analytics page makes. `URL.hostname` drops the path, query,
 * fragment, port, and any user:password credentials in one step; everything
 * else here rejects rather than repairs.
 *
 * Applied when the click is recorded, not when it's read: the read path
 * cannot un-store what ingestion already wrote down.
 */
export function normalizeReferrer(referrer: string): string {
  if (!referrer) return "";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "";
  }
  // A referrer arrives over http(s). Anything else (data:, javascript:,
  // file:, an app's custom scheme) is not a site we can name.
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  const host = url.hostname.toLowerCase();
  if (!isReportableHost(host)) return "";
  return host;
}

export function normalizeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    // URLs with a trailing dot or a one-character top-level domain are almost
    // always a pasted typo (for example, "http./path"). Keep IP addresses
    // valid, but require ordinary hostnames to have a real TLD.
    const hostname = url.hostname;
    if (hostname.endsWith(".") || hostname.includes(":")) return !hostname.endsWith(".");
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
    const labels = hostname.split(".");
    return labels.length > 1 && labels.at(-1)!.length >= 2;
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
export const qrLogoUrl = (orgId: string, file: string) => `/api/orgs/${orgId}/qr-logo/${file}`;

// Only the file name is charset-checked: it is ours (uid() + a known
// extension). The org id never goes through a regex — validateQrFields
// matches it by construction and qrLogoKeyFromUrl takes "one path segment" —
// so any org id works (the seed script's "seed-" ids included).
export const QR_LOGO_FILE_RE = /^[A-Za-z0-9]+\.[a-z0-9]+$/;

/** R2 key (`{orgId}/{file}`) for a serving URL, null for anything else. */
export function qrLogoKeyFromUrl(url: string): string | null {
  const m = /^\/api\/orgs\/([^/]+)\/qr-logo\/([A-Za-z0-9]+\.[a-z0-9]+)$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Background alone supports an alpha channel (the color picker's
// HexAlphaColorPicker emits 8-digit hex, or 6-digit when fully opaque).
const HEX_COLOR_ALPHA_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

type QrFields = {
  qrLogo?: string;
  qrStyle?: string;
  qrColor?: string;
  qrCorner?: string;
  qrBg?: string;
  qrEyeColor?: string;
  qrLogoSize?: number | null;
};

function invalidQrField(message: string): never {
  throw new HTTPException(400, { message });
}

function validateQrLogo(qrLogo: string | undefined, orgId: string) {
  if (!qrLogo) return;
  const prefix = qrLogoUrl(orgId, "");
  const file = qrLogo.startsWith(prefix) ? qrLogo.slice(prefix.length) : "";
  if (!QR_LOGO_FILE_RE.test(file)) invalidQrField("Logo must be an uploaded image");
}

function validateQrChoice(value: string | undefined, choices: readonly string[], message: string) {
  if (value && !choices.includes(value)) invalidQrField(message);
}

function validateQrColor(value: string | undefined, label: string) {
  if (value && !HEX_COLOR_RE.test(value)) {
    invalidQrField(`${label} must be a hex color like #17151f`);
  }
}

function validateQrBg(value: string | undefined) {
  if (!value) return;
  // 'transparent' is a legacy sentinel kept readable for old data; the
  // picker now expresses transparency through the hex string's alpha byte.
  if (value === "transparent") return;
  if (!HEX_COLOR_ALPHA_RE.test(value)) {
    invalidQrField("QR background must be a hex color like #17151f or #17151f80");
  }
}

function validateQrLogoSize(value: number | null | undefined) {
  if (value != null && (!Number.isFinite(value) || value < 0.2 || value > 0.7)) {
    invalidQrField("QR logo size must be a ratio between 0.2 and 0.7");
  }
}

/** Shared validation for org QR defaults and per-link overrides ('' = inherit). */
export function validateQrFields(fields: QrFields, orgId: string) {
  validateQrLogo(fields.qrLogo, orgId);
  validateQrChoice(fields.qrStyle, QR_DOT_STYLES, "Unknown QR dot style");
  validateQrChoice(fields.qrCorner, QR_CORNER_STYLES, "Unknown QR corner style");
  validateQrBg(fields.qrBg);
  validateQrColor(fields.qrColor, "QR color");
  validateQrColor(fields.qrEyeColor, "QR eye color");
  // null = inherit; otherwise a sane footprint ratio (bigger stops scanning).
  validateQrLogoSize(fields.qrLogoSize);
}
