import type { Env } from "./env";
import { buildDestination, type UtmFields } from "./util";

/**
 * KV holds the hot path: slug -> resolved destination (UTMs already applied)
 * plus the ids needed to record the click. D1 stays the source of truth.
 */
export interface KVLink {
  linkId: string;
  orgId: string;
  url: string;
}

export async function publishLink(
  env: Env,
  link: {
    id: string;
    orgId: string;
    slug: string;
    destination: string;
  } & UtmFields,
): Promise<void> {
  const value: KVLink = {
    linkId: link.id,
    orgId: link.orgId,
    url: buildDestination(link.destination, link),
  };
  await env.LINKS.put(`slug:${link.slug}`, JSON.stringify(value));
}

export async function unpublishLink(env: Env, slug: string): Promise<void> {
  await env.LINKS.delete(`slug:${slug}`);
}

export async function resolveSlug(
  env: Env,
  slug: string,
): Promise<KVLink | null> {
  return env.LINKS.get<KVLink>(`slug:${slug}`, "json");
}
