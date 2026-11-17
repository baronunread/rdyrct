const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLUG_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function randomFrom(alphabet: string, len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export const uid = (len = 16) => randomFrom(ID_ALPHABET, len);
export const randomSlug = () => randomFrom(SLUG_ALPHABET, 7);

export const ALIAS_TTL_MS = 48 * 60 * 60 * 1000;

export const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export const RESERVED_SLUGS = new Set([
  "__dev",
  "api",
  "app",
  "assets",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
  "pricing.md",
  "login",
  "signup",
  "onboarding",
  "welcome",
  "reset-password",
  "invite",
  "consent",
  "unsubscribe",
  "privacy",
  "terms",
  "report",
  "blog",
  "qr-code-generator",
  "utm-builder",
  "branded-link-shortener",
  "pricing",
  "roadmap",
  "changelog",
  "compare",
  "bitly-alternative",
  "rebrandly-alternative",
  "dub-alternative",
  "short-io-alternative",
  "google-url-shortener",
  "whatsapp-qr-code",
  "vcard-qr-code",
  "wifi-qr-code",
  "qr-code-monkey-alternative",
  "flowcode-alternative",
  "tinyurl-alternative",
  "docs",
  "dashboard",
  "analytics",
  "links",
  "import",
  "members",
  "organization",
  "billing",
  "domains",
  "settings",
  "api-keys",
  "admin",
  "audit",
]);

export {
  buildDestination,
  EMPTY_UTM,
  resolveUtm,
  stripUtmParams,
  type UtmFields,
} from "../shared/utm";

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

// Display-only list, so a miss costs nothing. Mainstream regional providers (qq.com) stay off. Keep entries lowercase.
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

export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

// A longer referrer is junk, not a hostname we failed to shorten, so it stores as empty.
const REFERRER_MAX_LENGTH = 253;

const REFERRER_MAX_LABEL_LENGTH = 63;

// Migration 0016 applies the same shape to older rows. Keep the two in step.
const REFERRER_ALLOWED_CHARS = /^[a-z0-9.-]+$/;

function isReportableHost(host: string): boolean {
  if (host.length > REFERRER_MAX_LENGTH) return false;
  if (!REFERRER_ALLOWED_CHARS.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => label.length > 0 && label.length <= REFERRER_MAX_LABEL_LENGTH);
}

// A raw Referer is a whole URL whose path and query carry other people tokens: none of that is ours to keep (#20).
// URL.hostname drops path, query, port and credentials in one step. Applied at ingestion: reads cannot un-store.
export function normalizeReferrer(referrer: string): string {
  if (!referrer) return "";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "";
  }
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

    // A trailing dot or a one-character TLD is almost always a typo (http./path). IP addresses stay valid.
    const hostname = url.hostname;
    if (hostname.endsWith(".") || hostname.includes(":")) return !hostname.endsWith(".");
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
    const labels = hostname.split(".");
    return labels.length > 1 && labels.at(-1)!.length >= 2;
  } catch {
    return false;
  }
}

import { HTTPException } from "hono/http-exception";
import { QR_CORNER_STYLES, QR_DOT_STYLES, type QrOverrides } from "@/shared/types";
import type { Env } from "./env";

export const qrLogoUrl = (orgId: string, file: string) => `/api/orgs/${orgId}/qr-logo/${file}`;

// Only the file name is charset-checked: the org id never goes through a regex, so any org id works (seed- ids too).
export const QR_LOGO_FILE_RE = /^[A-Za-z0-9]+\.[a-z0-9]+$/;

export function qrLogoKeyFromUrl(url: string): string | null {
  const m = /^\/api\/orgs\/([^/]+)\/qr-logo\/([A-Za-z0-9]+\.[a-z0-9]+)$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// Background alone supports alpha (HexAlphaColorPicker emits 8-digit hex).
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
  // transparent is a legacy sentinel kept readable for old data.
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

export function validateQrFields(fields: QrFields, orgId: string) {
  validateQrLogo(fields.qrLogo, orgId);
  validateQrChoice(fields.qrStyle, QR_DOT_STYLES, "Unknown QR dot style");
  validateQrChoice(fields.qrCorner, QR_CORNER_STYLES, "Unknown QR corner style");
  validateQrBg(fields.qrBg);
  validateQrColor(fields.qrColor, "QR color");
  validateQrColor(fields.qrEyeColor, "QR eye color");
  validateQrLogoSize(fields.qrLogoSize);
}

const QR_FIELDS = ["qrLogo", "qrStyle", "qrColor", "qrCorner", "qrBg", "qrEyeColor"] as const;

// Not carries QR fields: the editor sends a link styling back with every save, so refusing that left wiping the fields as the only way out (#162).
// Clearing is always allowed.
export function changesQr(
  body: Partial<QrOverrides>,
  existing: Partial<QrOverrides> | null,
): boolean {
  for (const field of QR_FIELDS) {
    const next = body[field];
    if (!next) continue;
    if (next !== (existing?.[field] ?? "")) return true;
  }
  return body.qrLogoSize != null && body.qrLogoSize !== (existing?.qrLogoSize ?? null);
}

export const sharedLinkHost = (env: Env) => env.SHARED_LINK_HOST || env.APP_HOST;

export function linkUrl(env: Env, domain: string | null, slug: string): string {
  if (domain) return `https://${domain}/${slug}`;
  if (env.SHARED_LINK_HOST) return `https://${env.SHARED_LINK_HOST}/${slug}`;
  return `${env.APP_URL}/${slug}`;
}
