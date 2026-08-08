import { eq, isNull, and, lt, ne, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { buildDestination, qrLogoKeyFromUrl } from "./util";
import { alertBetterStack } from "./alerts";

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
    // Resolved through link_addresses, not links directly: a slug key names
    // one active address (primary or alias), which always answers with its
    // parent link's effective destination, never one of its own. An
    // already-expired-but-not-yet-swept temp_alias still resolves here (its
    // retiredAt is still null) — the redirect path's own expiresAt check is
    // what actually stops it resolving; see index.ts.
    const rows = await db
      .select({
        addressId: schema.linkAddresses.id,
        expiresAt: schema.linkAddresses.expiresAt,
        linkId: schema.links.id,
        orgId: schema.links.orgId,
        destination: schema.links.destination,
        utmSource: schema.links.utmSource,
        utmMedium: schema.links.utmMedium,
        utmCampaign: schema.links.utmCampaign,
        utmTerm: schema.links.utmTerm,
        utmContent: schema.links.utmContent,
        hostname: schema.domains.hostname,
      })
      .from(schema.linkAddresses)
      .innerJoin(schema.links, eq(schema.linkAddresses.linkId, schema.links.id))
      .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
      .where(
        and(
          eq(schema.linkAddresses.slug, slug),
          isNull(schema.linkAddresses.retiredAt),
          hostname === null
            ? isNull(schema.linkAddresses.domainId)
            : eq(schema.domains.hostname, hostname),
        ),
      )
      .limit(1);
    const address = rows[0];
    if (!address) return null;
    return JSON.stringify({
      linkId: address.linkId,
      addressId: address.addressId,
      orgId: address.orgId,
      url: buildDestination(address.destination, address),
      expiresAt: address.expiresAt,
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
 * How long an unreferenced logo is left alone (#49).
 *
 * The upload route writes the R2 object and hands back its URL; the row that
 * points at it is written by a later request. Between those two an object is
 * legitimately unreferenced, so anything younger than this is not an orphan,
 * it is an upload still in progress. A day is far longer than that gap and
 * far shorter than the cost of keeping the object forever.
 */
const QR_LOGO_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Delete QR logos no row points at (#49).
 *
 * An upload creates an immutable R2 object before anything claims it, so an
 * abandoned upload (a client that never sends the follow-up, a retry with a
 * different image) leaves bytes with no owner, no quota and no delete path.
 * Replace, clear and delete all clean up after themselves; nothing cleaned
 * up after the uploads that never got that far.
 *
 * D1 stays the source of truth: this reads every logo URL still referenced,
 * then deletes the objects missing from that set. Being wrong in the safe
 * direction matters more than being thorough, so an object is only touched
 * once it is older than the grace period above.
 *
 * ponytail: reads every referencing row into memory, which is fine while a
 * logo is one short URL per link. If that stops being true, page the listing
 * against a per-org query instead.
 */
export async function sweepOrphanQrLogos(env: Env): Promise<number> {
  const db = drizzle(env.DB, { schema });
  const [linkRows, orgRows] = await Promise.all([
    db.select({ url: schema.links.qrLogo }).from(schema.links).where(ne(schema.links.qrLogo, "")),
    db.select({ url: schema.orgs.qrLogo }).from(schema.orgs).where(ne(schema.orgs.qrLogo, "")),
  ]);
  const referenced = new Set<string>();
  for (const { url } of [...linkRows, ...orgRows]) {
    const key = qrLogoKeyFromUrl(url);
    if (key) referenced.add(key);
  }

  const cutoff = Date.now() - QR_LOGO_ORPHAN_GRACE_MS;
  let cursor: string | undefined;
  let deleted = 0;
  for (;;) {
    const page = await env.QR_LOGOS.list({ cursor, limit: R2_LIST_LIMIT });
    const orphans = page.objects.flatMap((object) =>
      object.uploaded.getTime() < cutoff && !referenced.has(object.key) ? [object.key] : [],
    );
    if (orphans.length) {
      await env.QR_LOGOS.delete(orphans);
      deleted += orphans.length;
    }
    if (!page.truncated) return deleted;
    cursor = page.cursor;
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
          console.error("storage_message_dead_letter", message.body.op, targetOf(message.body));
        }
        message.retry();
      }
    }),
  );
}

/**
 * Consume the dead-letter queue: log and alert for visibility, then ack.
 * There is nothing to repair here (see the top of this file), just something
 * to see: a message reaching this point means Cloudflare Queues gave up on it
 * after every retry, which is worth knowing even though nothing re-drives it.
 */
export async function logDeadLetterBatch(
  env: Env,
  batch: MessageBatch<StorageMessage>,
): Promise<void> {
  const events = batch.messages.map((message) => ({
    event: "storage_message_gave_up",
    op: message.body.op,
    target: targetOf(message.body),
  }));
  for (const event of events) console.error(event.event, event.op, event.target);
  await alertBetterStack(env, events);
  for (const message of batch.messages) message.ack();
}

/* ---------------- org teardown steps (driven by the workflow) ---------------- */

/**
 * Read an org's Cloudflare hostname ids and KV keys before the org row leaves
 * D1. The workflow persists this so later steps still know what to clean up.
 * A link or domain created after this snapshot would miss this gather step,
 * but by the time this runs `deleteOrg` (routes/orgs.ts) has already marked
 * the org deleting, and every write route rejects on that before it can
 * happen.
 */
export async function orgDeleteGather(
  db: DB,
  orgId: string,
): Promise<{ cfHostnameIds: string[]; kvKeys: string[] }> {
  const [domains, addresses] = await Promise.all([
    db
      .select({ hostname: schema.domains.hostname, cfHostnameId: schema.domains.cfHostnameId })
      .from(schema.domains)
      .where(eq(schema.domains.orgId, orgId)),
    // Every active address (primary and alias), not just links: an alias
    // has its own KV key that a links-only gather would miss.
    db
      .select({ slug: schema.linkAddresses.slug, hostname: schema.domains.hostname })
      .from(schema.linkAddresses)
      .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
      .where(and(eq(schema.linkAddresses.orgId, orgId), isNull(schema.linkAddresses.retiredAt))),
  ]);
  const kvKeys = [
    ...addresses.map((a) => slugKey(a.hostname, a.slug)),
    ...domains.map((d) => domainKey(d.hostname)),
  ];
  const cfHostnameIds = domains.flatMap((d) => (d.cfHostnameId ? [d.cfHostnameId] : []));
  return { cfHostnameIds, kvKeys };
}

/** Delete a set of KV keys. Idempotent: deleting a missing key is a no-op. */
export async function deleteKvKeys(env: Env, keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => env.LINKS.delete(key)));
}

// Cloudflare Queues caps sendBatch at 100 messages: this sweep enqueues one
// sync message per expired row in a single sendBatch call below, so the page
// size can't exceed that.
const ALIAS_SWEEP_BATCH_SIZE = 100;

/**
 * Retire every rename alias past its 48-hour deadline, in bounded batches.
 * The redirect path (index.ts) already stops resolving an expired alias the
 * instant it's asked for, using only the expiry baked into its KV value: this
 * sweep just catches D1 and KV up afterward, so the slug frees for reuse and
 * the row stops looking active. Run daily (see scheduled() in index.ts); the
 * up-to-a-day gap between "stopped resolving" and "freed for reuse" is
 * accepted slop, not a correctness issue.
 */
export async function sweepExpiredAliases(env: Env, db: DB): Promise<void> {
  for (;;) {
    const expired = await db
      .select({
        id: schema.linkAddresses.id,
        slug: schema.linkAddresses.slug,
        hostname: schema.domains.hostname,
      })
      .from(schema.linkAddresses)
      .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
      .where(
        and(
          eq(schema.linkAddresses.kind, "temp_alias"),
          isNull(schema.linkAddresses.retiredAt),
          lt(schema.linkAddresses.expiresAt, Date.now()),
        ),
      )
      .limit(ALIAS_SWEEP_BATCH_SIZE);
    if (!expired.length) return;

    await db
      .update(schema.linkAddresses)
      .set({ retiredAt: Date.now() })
      .where(
        inArray(
          schema.linkAddresses.id,
          expired.map((a) => a.id),
        ),
      );
    // Re-sync each freed key: desiredKvValue now finds no active row for it
    // (the update above just retired it), so this converges to a delete.
    await enqueueStorage(
      env,
      expired.map((a) => syncLinkMsg(a.slug, a.hostname)),
    );
    if (expired.length < ALIAS_SWEEP_BATCH_SIZE) return;
  }
}
