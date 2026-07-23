import { eq, isNull, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { buildDestination, qrLogoKeyFromUrl } from "./util";

/**
 * Storage recovery. D1 is the source of truth. KV serves redirects and R2
 * stores QR logos. A request handler commits its D1 change, then awaits a
 * send to the storage queue describing the KV or R2 follow-up: if the send
 * itself fails, the request fails too, so a producer-side drop is never
 * silent. Once a message is on the queue, Cloudflare Queues own the retry,
 * backoff, and dead-letter behavior; a message that exhausts its retries is
 * logged for visibility (see the dead-letter consumer below), not repaired.
 *
 * Every message is a self-healing instruction the consumer can run more than
 * once. A `kv_sync` message names one KV key; the consumer reads the current
 * D1 truth for that key and writes or deletes to match. This makes order not
 * matter: whatever the last message for a key does, it lands on the current
 * D1 state. R2 deletes are naturally idempotent.
 */

export type StorageMessage =
  | { op: "kv_sync"; key: string }
  | { op: "r2_delete"; key: string }
  | { op: "r2_delete_prefix"; prefix: string };

const R2_LIST_LIMIT = 1_000;

// A failure on this many deliveries dead-letters the message. Keep this equal
// to the main queue's max_retries + 1 in wrangler.jsonc.
const STORAGE_MAX_DELIVERIES = 6;

/* ---------------- key helpers ---------------- */

const slugKey = (hostname: string | null, slug: string) =>
  hostname ? `slug:${hostname}:${slug}` : `slug:${slug}`;

const domainKey = (hostname: string) => `domain:${hostname}`;

/* ---------------- message builders ---------------- */

/** Sync a link's KV key. Publishes when the row exists, deletes when it does not. */
export function syncLinkMsg(slug: string, hostname: string | null): StorageMessage {
  return { op: "kv_sync", key: slugKey(hostname, slug) };
}

/** Sync a domain's KV key. Publishes an active domain, deletes anything else. */
export function syncDomainMsg(hostname: string): StorageMessage {
  return { op: "kv_sync", key: domainKey(hostname) };
}

/** Delete one QR logo object by its stored URL. Foreign or empty URLs are skipped. */
export function deleteQrLogoMsg(url: string): StorageMessage | null {
  const key = qrLogoKeyFromUrl(url);
  return key ? { op: "r2_delete", key } : null;
}

/* ---------------- producing messages ---------------- */

/**
 * Send messages to the storage queue. Skips nulls so callers can inline
 * conditions.
 */
export async function enqueueStorage(
  env: Env,
  messages: Array<StorageMessage | null>,
): Promise<void> {
  const batch = messages.flatMap((m) => (m ? [{ body: m }] : []));
  if (batch.length) await env.STORAGE_QUEUE.sendBatch(batch);
}

/* ---------------- consuming messages ---------------- */

function parseSlugKey(key: string): { hostname: string | null; slug: string } {
  const rest = key.slice("slug:".length);
  const sep = rest.indexOf(":");
  // A slug never holds a colon and a hostname never holds a colon, so the first
  // colon splits host from slug. No colon means the shared default host.
  if (sep === -1) return { hostname: null, slug: rest };
  return { hostname: rest.slice(0, sep), slug: rest.slice(sep + 1) };
}

/**
 * The value a KV key should hold given the current D1 state, or null when the
 * key should not exist. This is the single definition of desired KV state,
 * shared by the queue consumer and reconciliation.
 */
async function desiredKvValue(db: DB, key: string): Promise<string | null> {
  if (key.startsWith("slug:")) {
    const { hostname, slug } = parseSlugKey(key);
    const rows = await db
      .select({
        id: schema.links.id,
        orgId: schema.links.orgId,
        slug: schema.links.slug,
        destination: schema.links.destination,
        utmSource: schema.links.utmSource,
        utmMedium: schema.links.utmMedium,
        utmCampaign: schema.links.utmCampaign,
        utmTerm: schema.links.utmTerm,
        utmContent: schema.links.utmContent,
        hostname: schema.domains.hostname,
      })
      .from(schema.links)
      .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
      .where(
        and(
          eq(schema.links.slug, slug),
          hostname === null ? isNull(schema.links.domainId) : eq(schema.domains.hostname, hostname),
        ),
      )
      .limit(1);
    const link = rows[0];
    if (!link) return null;
    return JSON.stringify({
      linkId: link.id,
      orgId: link.orgId,
      url: buildDestination(link.destination, link),
    });
  }

  if (key.startsWith("domain:")) {
    const hostname = key.slice("domain:".length);
    const rows = await db
      .select()
      .from(schema.domains)
      .where(eq(schema.domains.hostname, hostname))
      .limit(1);
    const domain = rows[0];
    if (!domain || domain.status !== "active") return null;
    return JSON.stringify({
      domainId: domain.id,
      orgId: domain.orgId,
      rootRedirect: domain.rootRedirect,
    });
  }

  // Unknown prefix: never enqueued, so leave it alone.
  return null;
}

async function kvSync(env: Env, db: DB, key: string): Promise<void> {
  const value = await desiredKvValue(db, key);
  if (value === null) await env.LINKS.delete(key);
  else await env.LINKS.put(key, value);
}

/** Delete every R2 object under a prefix, one page at a time. */
export async function deleteR2Prefix(env: Env, prefix: string): Promise<void> {
  for (;;) {
    const page = await env.QR_LOGOS.list({ prefix, limit: R2_LIST_LIMIT });
    if (!page.objects.length) return;
    await env.QR_LOGOS.delete(page.objects.map((object) => object.key));
  }
}

/**
 * Run one storage message. Throws on failure so the queue retries it. Every
 * branch is safe to run more than once.
 */
export async function applyStorageMessage(
  env: Env,
  db: DB,
  message: StorageMessage,
): Promise<void> {
  switch (message.op) {
    case "kv_sync":
      await kvSync(env, db, message.key);
      return;
    case "r2_delete":
      await env.QR_LOGOS.delete(message.key);
      return;
    case "r2_delete_prefix":
      await deleteR2Prefix(env, message.prefix);
      return;
  }
}

function targetOf(message: StorageMessage): string {
  return message.op === "r2_delete_prefix" ? message.prefix : message.key;
}

/**
 * Consume a batch off the storage queue: ack on success, retry on failure.
 * Cloudflare Queues own the backoff and move a message to the dead-letter
 * queue once it runs out of deliveries. A message on its last delivery here
 * logs a `storage_message_dead_letter` line so `wrangler tail` shows what is
 * about to dead-letter, ahead of the dead-letter consumer below logging the
 * same message again once it actually lands there.
 *
 * Messages run concurrently: each acks or retries independently, and every
 * message is safe to apply in any order (see the top of this file), so there
 * is nothing sequential to preserve by awaiting them one at a time.
 */
export async function consumeStorageBatch(
  env: Env,
  batch: MessageBatch<StorageMessage>,
): Promise<void> {
  const db = drizzle(env.DB, { schema });
  await Promise.all(
    batch.messages.map(async (message) => {
      try {
        await applyStorageMessage(env, db, message.body);
        message.ack();
      } catch (error) {
        console.error("storage message failed", targetOf(message.body), error);
        if (message.attempts >= STORAGE_MAX_DELIVERIES) {
          console.error(
            JSON.stringify({
              event: "storage_message_dead_letter",
              op: message.body.op,
              target: targetOf(message.body),
            }),
          );
        }
        message.retry();
      }
    }),
  );
}

/**
 * Consume the dead-letter queue: log for visibility, then ack. There is
 * nothing to repair here (see the top of this file), just something to see:
 * a message reaching this point means Cloudflare Queues gave up on it after
 * every retry, which is worth knowing even though nothing re-drives it.
 */
export function logDeadLetterBatch(batch: MessageBatch<StorageMessage>): void {
  for (const message of batch.messages) {
    console.error(
      JSON.stringify({
        event: "storage_message_gave_up",
        op: message.body.op,
        target: targetOf(message.body),
      }),
    );
    message.ack();
  }
}

/* ---------------- org teardown steps (driven by the workflow) ---------------- */

/**
 * Read an org's Cloudflare hostname ids and KV keys before the org row leaves
 * D1. The workflow persists this so later steps still know what to clean up.
 */
export async function orgDeleteGather(
  db: DB,
  orgId: string,
): Promise<{ cfHostnameIds: string[]; kvKeys: string[] }> {
  const [domains, links] = await Promise.all([
    db
      .select({ hostname: schema.domains.hostname, cfHostnameId: schema.domains.cfHostnameId })
      .from(schema.domains)
      .where(eq(schema.domains.orgId, orgId)),
    db
      .select({ slug: schema.links.slug, hostname: schema.domains.hostname })
      .from(schema.links)
      .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
      .where(eq(schema.links.orgId, orgId)),
  ]);
  const kvKeys = [
    ...links.map((l) => slugKey(l.hostname, l.slug)),
    ...domains.map((d) => domainKey(d.hostname)),
  ];
  const cfHostnameIds = domains.flatMap((d) => (d.cfHostnameId ? [d.cfHostnameId] : []));
  return { cfHostnameIds, kvKeys };
}

/** Delete a set of KV keys. Idempotent: deleting a missing key is a no-op. */
export async function deleteKvKeys(env: Env, keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => env.LINKS.delete(key)));
}
