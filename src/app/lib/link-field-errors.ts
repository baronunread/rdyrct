/**
 * Which field of the link editor a failed save is about, and what to say in
 * its label row.
 *
 * A form error marks its field (rdyrct-design): the server's refusal of a
 * destination or a slug belongs on that field, not in a toast. The API sends
 * a code for some of these and only a message for the rest, so this reads
 * both. TODO(lead): give every destination and slug refusal in
 * `src/worker/routes/links.ts`, `abuse.ts` and `abuse-hold.ts` a code (say
 * `bad_destination`, `blocked_destination`, `shortener_destination`,
 * `own_short_link`, `bad_slug`, `reserved_slug`) and match on those alone.
 */
import { ApiError } from "./api";

export type LinkErrorField = "destination" | "slug";

export interface LinkFieldError {
  field: LinkErrorField;
  /** A few words for the label row. */
  reason: string;
  /** The whole explanation, for screen readers and on hover. */
  detail: string;
}

const RULES: { field: LinkErrorField; reason: string; test: (e: ApiError) => boolean }[] = [
  { field: "slug", reason: "Already taken", test: (e) => e.code === "slug_taken" },
  { field: "slug", reason: "Already an alias", test: (e) => e.code === "slug_is_own_alias" },
  {
    field: "slug",
    reason: "Letters, numbers, - and _",
    test: (e) => e.message.startsWith("Slug may only"),
  },
  { field: "slug", reason: "Reserved", test: (e) => /slug is reserved/i.test(e.message) },
  {
    field: "slug",
    reason: "Random on this domain",
    test: (e) => /keep their random slug/.test(e.message),
  },
  {
    field: "destination",
    reason: "Not a web address",
    test: (e) => e.message.startsWith("Destination must be a valid"),
  },
  {
    field: "destination",
    reason: "Another shortener",
    test: (e) => /another link shortener/i.test(e.message),
  },
  {
    field: "destination",
    reason: "Already a short link",
    test: (e) => /another rdyrct short link/i.test(e.message),
  },
  {
    field: "destination",
    reason: "Not allowed",
    test: (e) => /destination is not allowed/i.test(e.message),
  },
];

/** The field a save error belongs to, or null when no field owns it (a toast
 * says those). */
export function linkFieldError(error: Error): LinkFieldError | null {
  if (!(error instanceof ApiError)) return null;
  const rule = RULES.find((r) => r.test(error));
  return rule ? { field: rule.field, reason: rule.reason, detail: error.message } : null;
}

/**
 * The same test the server makes of a destination (`isValidHttpUrl` in
 * `src/worker/util.ts`), so a typo is marked before the round trip: a
 * scheme-less address gets https://, and a host needs a real top-level
 * domain. "copperkettle winter menu" passes a plain URL check and fails this.
 */
export function isWebAddress(raw: string): boolean {
  const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  if (host.endsWith(".") || host.includes(":")) return !host.endsWith(".");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  const labels = host.split(".");
  return labels.length > 1 && (labels.at(-1)?.length ?? 0) >= 2;
}
