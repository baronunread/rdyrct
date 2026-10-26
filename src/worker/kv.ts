import type { Env } from "./env";
import { buildDestination, type UtmFields } from "./util";

/**
 * KV holds the hot path. D1 stays the source of truth.
 *   slug:{slug}            -> KVSlugValue (shared default domain)
 *   slug:{hostname}:{slug} -> KVSlugValue (custom domain)
 *   domain:{hostname}      -> KVDomain    (active custom domains)
 */
export interface KVLink {
  linkId: string;
  // The specific address this key resolves for (primary or an alias):
  // carried through to the click event for per-address attribution.
  addressId: string;
  orgId: string;
  url: string;
  // Epoch ms; null = never expires. The redirect path compares this against
  // Date.now() to lazily stop resolving an expired temporary alias without a
  // D1 read (see index.ts's redirect middleware).
  expiresAt: number | null;
  // #344: show the destination host and a Continue button before sending the
  // visitor on. Absent on every value written before it existed, and on every
  // link without a warning, which both mean "redirect straight away".
  warn?: true;
}

/**
 * A held (suspended) link's key (#344). The key stays in KV so the redirect
 * path can answer "under review" with no D1 read, where it used to delete the
 * key and answer 404. It carries no destination: nothing on the redirect path
 * may send anyone to a held link's URL, and a value with no URL in it cannot.
 */
export interface KVHeldLink {
  held: true;
  linkId: string;
  expiresAt: number | null;
  // The owner was banned: the decision is made, so the page says "disabled"
  // rather than "under review". Absent means held for review.
  disabled?: true;
}

export type KVSlugValue = KVLink | KVHeldLink;

export function isHeld(value: KVSlugValue): value is KVHeldLink {
  return "held" in value && value.held;
}

export interface KVDomain {
  domainId: string;
  orgId: string;
  rootRedirect: string;
  /**
   * Epoch ms this host stops resolving, or null/absent for "keeps serving"
   * (#159).
   *
   * A downgraded org's extra domains keep working for 30 days, and the
   * redirect path has to know that without a D1 read, so the deadline rides
   * in the value rather than being looked up per request. Reconciliation
   * writes it; nothing rewrites it when the day arrives, because a stored
   * deadline needs no cron to expire.
   */
  servesUntil?: number | null;
  // The org's owner was banned: every path on the host answers "disabled",
  // root redirect included. Absent means serving.
  disabled?: true;
}

/** Whether a custom domain still resolves. A value written before
 * `servesUntil` existed has it undefined, which means "keeps serving". */
export function domainServing(domain: KVDomain, now = Date.now()): boolean {
  return domain.servesUntil == null || domain.servesUntil > now;
}

const slugKey = (hostname: string | null, slug: string) =>
  hostname ? `slug:${hostname}:${slug}` : `slug:${slug}`;

export async function publishLink(
  env: Env,
  link: {
    id: string;
    addressId: string;
    orgId: string;
    slug: string;
    destination: string;
    expiresAt?: number | null;
  } & UtmFields,
  hostname: string | null,
): Promise<void> {
  const value: KVLink = {
    linkId: link.id,
    addressId: link.addressId,
    orgId: link.orgId,
    url: buildDestination(link.destination, link),
    expiresAt: link.expiresAt ?? null,
  };
  await env.LINKS.put(slugKey(hostname, link.slug), JSON.stringify(value));
}

export async function unpublishLink(
  env: Env,
  slug: string,
  hostname: string | null,
): Promise<void> {
  await env.LINKS.delete(slugKey(hostname, slug));
}

export async function resolveSlug(
  env: Env,
  slug: string,
  hostname: string | null,
): Promise<KVSlugValue | null> {
  return env.LINKS.get<KVSlugValue>(slugKey(hostname, slug), "json");
}

export async function publishDomain(
  env: Env,
  domain: {
    id: string;
    orgId: string;
    hostname: string;
    rootRedirect: string;
    servesUntil?: number | null;
  },
): Promise<void> {
  const value: KVDomain = {
    domainId: domain.id,
    orgId: domain.orgId,
    rootRedirect: domain.rootRedirect,
    servesUntil: domain.servesUntil ?? null,
  };
  await env.LINKS.put(`domain:${domain.hostname}`, JSON.stringify(value));
}

export async function unpublishDomain(env: Env, hostname: string): Promise<void> {
  await env.LINKS.delete(`domain:${hostname}`);
}

export async function resolveDomain(env: Env, hostname: string): Promise<KVDomain | null> {
  return env.LINKS.get<KVDomain>(`domain:${hostname}`, "json");
}
