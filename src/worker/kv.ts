import type { Env } from "./env";
import { buildDestination, EMPTY_UTM, type UtmFields } from "./util";

// slug:{slug} (shared domain) and slug:{hostname}:{slug} (custom domain) -> KVSlugValue; domain:{hostname} -> KVDomain.
// D1 stays the source of truth.
export interface KVLink {
  linkId: string;
  addressId: string;
  orgId: string;
  url: string;
  // Epoch ms; null = never expires. Compared against Date.now() so an expired temporary alias stops resolving with no D1 read.
  expiresAt: number | null;
  // Absent means redirect straight away (older values and unwarned links).
  warn?: true;
}

// A held link keeps a KV key so the redirect path answers under review with no D1 read. It carries no destination:
// a value with no URL cannot send anyone to a held link (#344).
export interface KVHeldLink {
  held: true;
  linkId: string;
  expiresAt: number | null;
  // Owner banned: the page says disabled, not under review. Absent means held for review.
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
  // Epoch ms this host stops resolving (#159). The deadline rides in the value so the redirect path needs no D1 read, and no cron is needed to expire it.
  servesUntil?: number | null;
  // Owner banned: every path on the host answers disabled, root redirect included.
  disabled?: true;
}

// undefined means keeps serving (a value written before servesUntil existed).
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

// orgId empty tells the redirect path not to record a click: there is no link and no org for one (#96, #488).
export async function publishAnonLink(
  env: Env,
  anon: { id: string; slug: string; destination: string; expiresAt: number; warned: boolean },
): Promise<void> {
  const value: KVLink = {
    linkId: anon.id,
    addressId: anon.id,
    orgId: "",
    url: buildDestination(anon.destination, EMPTY_UTM),
    expiresAt: anon.expiresAt,
    ...(anon.warned && { warn: true as const }),
  };
  await env.LINKS.put(slugKey(null, anon.slug), JSON.stringify(value));
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
