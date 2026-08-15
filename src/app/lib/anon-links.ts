/**
 * The links somebody made on the landing page before they had an account
 * (Direction A of #96).
 *
 * They live in localStorage, not just in React state, so a reload does not
 * throw them away. A short link nobody wrote down is worthless, and the most
 * likely moment to lose one is exactly when somebody navigates off to read
 * about pricing and comes back.
 *
 * The whole record is kept, not only the claim token: the short URL and the
 * address it came from are what the hero renders, and re-deriving them would
 * mean asking the server for links it deliberately does not let anyone list.
 * All of it is the visitor's own data, in their own browser, and it never
 * leaves it except as the claim at signup.
 *
 * Every failure here is silent. A browser with storage disabled must still
 * be able to shorten a link and sign up; it just cannot keep them across a
 * reload.
 */
import * as v from "valibot";
import { api } from "./api";
import type { AnonLink } from "./shorten-anon";

/** Bumped from v2, which stored bare claim tokens. An old value parses as
 * junk and is discarded, which costs a visitor links that were about to
 * expire anyway. */
const KEY = "rdyrct:anon-links:v3";

/**
 * How many links one browser may make without an account.
 *
 * A product limit, not a security one: abuse is already handled by the Cap
 * proof-of-work and RL_ANON_LINK, both of which a browser cannot talk its
 * way past. This is the point where trying it becomes signing up. It frees
 * up as links expire, and claiming at signup clears it entirely.
 */
export const MAX_ANON_LINKS = 3;

const storedAnonLinkSchema = v.object({
  slug: v.string(),
  url: v.string(),
  /** The address it was made from: the question that appears once there is
   * more than one on screen. */
  source: v.string(),
  claimToken: v.string(),
  expiresAt: v.number(),
});

export type StoredAnonLink = v.InferOutput<typeof storedAnonLinkSchema>;

/** Everything under our key that is still a link, in the order stored. A
 * browser holding junk there contributes nothing rather than shaping what
 * signup does. */
const storedListSchema = v.pipe(
  v.array(v.unknown()),
  v.transform((entries) =>
    entries.flatMap((entry) => {
      const parsed = v.safeParse(storedAnonLinkSchema, entry);
      return parsed.success ? [parsed.output] : [];
    }),
  ),
);

/**
 * Everything still worth showing, newest first.
 *
 * Expired records are dropped on read rather than on a timer: nothing here
 * runs while the tab is closed, and the server has forgotten them anyway, so
 * a link past its 24 hours would render as a URL that 404s.
 */
export function storedAnonLinks(): StoredAnonLink[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    // Anything unexpected is discarded rather than repaired: a browser
    // holding junk under our key must not be able to shape what signup does.
    const parsed = v.safeParse(storedListSchema, JSON.parse(raw));
    if (!parsed.success) return [];
    const now = Date.now();
    return parsed.output.filter((link) => link.expiresAt > now);
  } catch {
    return [];
  }
}

function write(links: StoredAnonLink[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(links.slice(0, MAX_ANON_LINKS)));
  } catch {
    // Private mode, or storage disabled. The links still work for 24 hours.
  }
}

/** Records a new link at the front, and returns the list as it now stands so
 * the caller renders exactly what was kept. */
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
  } catch {
    /* nothing to clean up if we could not write in the first place */
  }
}

/**
 * Hands every kept link to a freshly created org, and reports how many
 * landed.
 *
 * Best-effort in every direction: no links is the common case, and a
 * rejected claim means the link expired, somebody already took it, or the
 * org is at its cap. None of that is worth a message, because the person
 * came here to make an organization and that already worked.
 *
 * Together rather than one after another: these are independent requests and
 * somebody is waiting on the org they just made. They are forgotten before
 * the first request, so a claim that cannot be spent does not follow anyone
 * around forever.
 */
export async function claimPendingLinks(orgId: string): Promise<number> {
  try {
    const links = storedAnonLinks();
    if (links.length === 0) return 0;
    forgetAnonLinks();

    // allSettled, not all: one refused claim must not stop the others landing.
    const results = await Promise.allSettled(
      links.map(({ claimToken }) =>
        api(`/orgs/${orgId}/links/claim`, { method: "POST", body: { claimToken } }),
      ),
    );
    return results.filter((r) => r.status === "fulfilled").length;
  } catch {
    // Best-effort here means it cannot throw, not that its callers remember
    // to catch. Both of them ran this inside the try that creates the
    // organization, so a browser refusing localStorage (private mode, a
    // blocked third-party context) reported "could not create your
    // organization" for one that exists, and skipped the switch and the
    // redirect that come after.
    return 0;
  }
}
