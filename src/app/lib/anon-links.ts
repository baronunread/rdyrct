// Kept in localStorage so a reload does not lose a link nobody wrote down. The whole record
// is kept: the server deliberately lets nobody list links, so the hero could not re-derive it.
// Every failure is silent: a browser with storage disabled must still shorten and sign up.
import * as v from "valibot";
import { api } from "./api";
import type { AnonLink } from "./shorten-anon";

// An old value parses as junk and is discarded: v2 stored bare claim tokens.
const KEY = "rdyrct:anon-links:v3";

// A product limit, not a security one: Turnstile and the anon_link rate limit handle abuse.
// The second link is where trying it becomes signing up. It frees as the link expires.
export const MAX_ANON_LINKS = 1;

const storedAnonLinkSchema = v.object({
  slug: v.string(),
  url: v.string(),
  source: v.string(),
  claimToken: v.string(),
  expiresAt: v.number(),
});

export type StoredAnonLink = v.InferOutput<typeof storedAnonLinkSchema>;

const storedListSchema = v.pipe(
  v.array(v.unknown()),
  v.transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = v.safeParse(storedAnonLinkSchema, entry);
      return parsed.success ? [parsed.output] : [];
    }),
  ),
);

// Expired records are dropped on read, not on a timer: the server has forgotten them,
// so a link past its 24 hours would render as a URL that 404s.
export function storedAnonLinks(): StoredAnonLink[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    // Anything unexpected is discarded rather than repaired: a browser
    // holding junk under our key must not shape what signup does.
    const parsed = v.safeParse(storedListSchema, JSON.parse(raw));
    if (!parsed.success) return [];
    const now = Date.now();
    // Sliced on the way out as well as in: a browser that made three links before the
    // cap dropped still holds all three, and the hero must not show more than the cap.
    return parsed.output.filter((link) => link.expiresAt > now).slice(0, MAX_ANON_LINKS);
  } catch {
    return [];
  }
}

// The `storage` event only reaches other tabs, and the landing page's link bar lives in this one.
const ANON_LINKS_CHANGED = "rdyrct:anon-links";

export function anonLinksSnapshot(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function subscribeAnonLinks(onChange: () => void): () => void {
  window.addEventListener(ANON_LINKS_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(ANON_LINKS_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function write(links: StoredAnonLink[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(links.slice(0, MAX_ANON_LINKS)));
    window.dispatchEvent(new Event(ANON_LINKS_CHANGED));
  } catch {}
}

export function rememberAnonLink(link: AnonLink, source: string): StoredAnonLink[] {
  const existing = storedAnonLinks().filter((l) => l.slug !== link.slug);
  const next = [
    {
      slug: link.slug,
      url: link.url,
      source,
      claimToken: link.claimToken,
      expiresAt: link.expiresAt,
    },
    ...existing,
  ].slice(0, MAX_ANON_LINKS);
  write(next);
  return next;
}

function forgetAnonLinks(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

// Best-effort: a rejected claim means the link expired, was taken, or the org is at its
// cap, and none of that is worth a message. Claims run together and are forgotten
// before the first request, so a claim that cannot be spent does not follow anyone around.
export async function claimPendingLinks(orgId: string): Promise<number> {
  try {
    const links = storedAnonLinks();
    if (links.length === 0) return 0;
    forgetAnonLinks();

    const results = await Promise.allSettled(
      links.map(({ claimToken }) =>
        api(`/orgs/${orgId}/links/claim`, { method: "POST", body: { claimToken } }),
      ),
    );
    return results.filter((r) => r.status === "fulfilled").length;
  } catch {
    // Best-effort here means it cannot throw: callers run this inside the try that creates the
    // org, so a browser refusing localStorage reported "could not create your organization"
    // for one that exists, and skipped the switch and redirect after it.
    return 0;
  }
}
