import type { Env } from "./env";
import { buildDestination, type UtmFields } from "./util";

/**
 * KV holds the hot path. D1 stays the source of truth.
 *   slug:{slug}            -> KVLink   (shared default domain)
 *   slug:{hostname}:{slug} -> KVLink   (custom domain)
 *   domain:{hostname}      -> KVDomain (active custom domains)
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
}

export interface KVDomain {
  domainId: string;
  orgId: string;
  rootRedirect: string;
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
): Promise<KVLink | null> {
  return env.LINKS.get<KVLink>(slugKey(hostname, slug), "json");
}

export async function publishDomain(
  env: Env,
  domain: { id: string; orgId: string; hostname: string; rootRedirect: string },
): Promise<void> {
  const value: KVDomain = {
    domainId: domain.id,
    orgId: domain.orgId,
    rootRedirect: domain.rootRedirect,
  };
  await env.LINKS.put(`domain:${domain.hostname}`, JSON.stringify(value));
}

export async function unpublishDomain(env: Env, hostname: string): Promise<void> {
  await env.LINKS.delete(`domain:${hostname}`);
}

export async function resolveDomain(env: Env, hostname: string): Promise<KVDomain | null> {
  return env.LINKS.get<KVDomain>(`domain:${hostname}`, "json");
}
