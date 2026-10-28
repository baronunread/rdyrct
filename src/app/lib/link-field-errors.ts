/**
 * Which field of the link editor a failed save is about, and what to say in
 * its label row.
 *
 * A form error marks its field (rdyrct-design): the server's refusal of a
 * destination or a slug belongs on that field, not in a toast. Every such
 * refusal carries a code (`cause: { code }` in `routes/links.ts`,
 * `abuse.ts` and `abuse-hold.ts`), and this reads the code alone: the
 * message is for people and may change.
 */
import { lookup } from "@/shared/lookup";
import { ApiError } from "./api";

export type LinkErrorField = "destination" | "slug";

export interface LinkFieldError {
  field: LinkErrorField;
  /** A few words for the label row. */
  reason: string;
  /** The whole explanation, for screen readers and on hover. */
  detail: string;
}

const RULES = {
  slug_taken: { field: "slug", reason: "Already taken" },
  slug_is_own_alias: { field: "slug", reason: "Already an alias" },
  bad_slug: { field: "slug", reason: "Letters, numbers, - and _" },
  reserved_slug: { field: "slug", reason: "Reserved" },
  slug_locked: { field: "slug", reason: "Random on this domain" },
  bad_destination: { field: "destination", reason: "Not a web address" },
  shortener_destination: { field: "destination", reason: "Another shortener" },
  own_short_link: { field: "destination", reason: "Already a short link" },
  blocked_destination: { field: "destination", reason: "Not allowed" },
} satisfies Record<string, { field: LinkErrorField; reason: string }>;

/** The field a save error belongs to, or null when no field owns it (a toast
 * says those). */
export function linkFieldError(error: Error): LinkFieldError | null {
  if (!(error instanceof ApiError) || !error.code) return null;
  const rule = lookup(RULES, error.code);
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
