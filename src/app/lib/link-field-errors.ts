// Reads the error code alone: the message is for people and may change. Codes come from
// `cause: { code }` in `routes/links.ts`, `abuse.ts` and `abuse-hold.ts`. A custom
// domain's root redirect uses the same destination rules (#488).
import { lookup } from "@/shared/lookup";
import { ApiError } from "./api";

export type LinkErrorField = "destination" | "slug";

export interface LinkFieldError {
  field: LinkErrorField;
  reason: string;
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
  own_domain: { field: "destination", reason: "This domain itself" },
  blocked_destination: { field: "destination", reason: "Not allowed" },
} satisfies Record<string, { field: LinkErrorField; reason: string }>;

export function linkFieldError(error: Error): LinkFieldError | null {
  if (!(error instanceof ApiError) || !error.code) return null;
  const rule = lookup(RULES, error.code);
  return rule ? { field: rule.field, reason: rule.reason, detail: error.message } : null;
}

// The same test as the server's `isValidHttpUrl` (`src/worker/util.ts`), so a typo is
// marked before the round trip. "copperkettle winter menu" passes a plain URL check.
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
