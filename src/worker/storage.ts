import * as Sentry from "@sentry/cloudflare";
import { eq, isNull, and, lt, ne, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { buildDestination, qrLogoKeyFromUrl, uid } from "./util";
import { captureAlert } from "./sentry";
import type { KVDomain } from "./kv";

/**
 * Storage recovery. D1 is the source of truth. KV serves redirects and R2
 * stores QR logos. A request handler commits its D1 change, then awaits a
 * send to the storage queue describing the KV or R2 follow-up: if the send
 * itself fails, the request fails too, so a producer-side drop is never
 * silent. Once a message is on the queue, Cloudflare Queues own the retry,
 * backoff, and dead-letter behavior.
 *
 * **The idempotency contract.** Every message is a self-healing instruction
 * the consumer may run any number of times, in any order, at any later
 * moment, and land on the right answer. A `kv_sync` names one KV key and
 * nothing else: the consumer reads the current D1 truth for that key and
 * writes or deletes to match, so it carries no value that could go stale
 * between the send and the apply. R2 deletes are naturally idempotent.
 *
 * That contract is what everything below is allowed to assume, so it is
 * tested rather than trusted: see `tests/worker/storage-outbox.worker.ts`.
 * Anything added to `StorageMessage` has to keep it. A message carrying the
 * value to write, rather than the key to look up, would break replay in a way
 * nothing else here would notice.
 *
 * **What repairs a gap.** Both holes are after the D1 commit, so neither can
 * be answered by failing the request (#118). A `sendBatch` that fails, and a
 * message that exhausts every delivery, both write a `storage_outbox` row,
 * and the daily drain applies it. Late rather than lost, and correct when it
 * lands because the contract above means the drain re-derives the value
 * instead of replaying an old one.
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
  if (!batch.length) return;
  try {
    await env.STORAGE_QUEUE.sendBatch(batch);
  } catch (error) {
    // D1 is already committed by the time this runs, so a failed send used to
    // leave KV serving the old value with nothing scheduled to fix it, and
    // the caller holding an error for a mutation that succeeded (#118).
    // Recording the work makes it late rather than lost.
    await recordOutbox(
      env,
      batch.map((entry) => entry.body),
      "send_failed",
      // Narrowed here, where it arrives: a caught value is only ever a
      // string worth keeping when it is an Error.
      error instanceof Error ? error.message.slice(0, 500) : "",
    );
    throw error;
  }
}

/* ---------------- outbox: work the queue did not take ---------------- */

/**
 * Remembers storage work so the daily drain can apply it (#118).
 *
 * Never throws, but it does report. A caller on the request path is already
 * failing and has nothing better to do with a second error; the dead-letter
 * consumer is not, and must not acknowledge a message whose only remaining
 * record failed to persist.
 *
 * One pending row per target, because applying desired state twice is a
 * no-op: a repeat failure for the same key replaces the first rather than
 * queueing a duplicate drain. That replacement takes a fresh `id`, which is
 * what the drain's delete matches on, so a request arriving mid-drain is
 * never removed unapplied.
 */
async function recordOutbox(
  env: Env,
  messages: StorageMessage[],
  reason: "send_failed" | "gave_up",
  detail = "",
): Promise<boolean> {
  const now = Date.now();
  try {
    // Neither `created_at` nor `attempts` is reset on conflict. Both are how
    // the drain decides what to read, and a key that fails a send daily and
    // fails its drain daily would otherwise look brand new every time: never
    // sinking behind fresher work, and never accumulating the attempts that
    // make a permanently broken row findable.
    await env.DB.batch(
      messages.map((message) =>
        env.DB.prepare(
          `insert into storage_outbox (id, op, target, reason, created_at, attempts, last_error)
           values (?, ?, ?, ?, ?, 0, ?)
           on conflict (op, target) do update set
             id = excluded.id,
             reason = excluded.reason,
             last_error = excluded.last_error`,
        ).bind(uid(), message.op, targetOf(message), reason, now, detail),
      ),
    );
    return true;
  } catch (writeError) {
    captureAlert([{ event: "storage_outbox_write_failed", reason, count: messages.length }]);
    console.error("storage_outbox_write_failed", reason, writeError);
    return false;
  }
}

/** How many outbox rows one drain will attempt. Bounded so a large backlog
 * costs several days rather than one cron run that times out. */
const OUTBOX_DRAIN_LIMIT = 200;

/** How much later each failed attempt makes a row sort, so a repeatedly
 * failing key yields to fresher work without ever being excluded outright.
 * The drain runs daily, so the unit is a day too: an hour made 200 old rows
 * monopolise roughly 24 daily passes before one newer repair was selected. */
export const OUTBOX_RETRY_BACKOFF = 24 * 60 * 60 * 1000;

/**
 * Applies the storage work the queue never did, oldest first (#118).
 *
 * This re-derives the value rather than replaying a captured one, which is
 * what makes a late apply correct instead of merely late: `applyStorageMessage`
 * reads current D1 state and writes what it finds, so a key whose row changed
 * twice since the failure lands on the answer it should have now.
 *
 * Returns how many rows it cleared.
 */
export async function drainStorageOutbox(env: Env): Promise<number> {
  const db = drizzle(env.DB, { schema });
  // Oldest first, counting each failed attempt as a day of age it has not
  // earned. Both plain orderings starve something: by age alone, 200 rows
  // that always fail hold the whole limit forever and a later recovery never
  // drains; by attempts alone, a steady 200 rows a day of new work means a
  // row that failed once never comes up again even after KV recovers.
  //
  // Backing a row off by its attempts is neither. It drops behind fresher
  // work for a while and climbs back as real time passes, so nothing is
  // permanently excluded and a hot failure cannot monopolise the pass.
  const rows = await db
    .select()
    .from(schema.storageOutbox)
    .orderBy(
      sql`${schema.storageOutbox.createdAt} + ${schema.storageOutbox.attempts} * ${sql.raw(String(OUTBOX_RETRY_BACKOFF))}`,
    )
    .limit(OUTBOX_DRAIN_LIMIT);
  let cleared = 0;
  for (const row of rows) {
    try {
      await applyStorageMessage(env, db, outboxMessage(row));
      // `id` is the revision: every re-record takes a fresh one, so a failure
      // that arrived while this row was being applied does not match here and
      // survives to be drained on its own terms.
      await db.delete(schema.storageOutbox).where(eq(schema.storageOutbox.id, row.id));
      cleared++;
    } catch (error) {
      // Left in place, with its attempt count, so a permanently broken row can
      // be found rather than retried forever in silence.
      await db
        .update(schema.storageOutbox)
        .set({
          attempts: row.attempts + 1,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "",
        })
        .where(eq(schema.storageOutbox.id, row.id));
      captureAlert([
        {
          event: "storage_outbox_drain_failed",
          op: row.op,
          target: row.target,
          attempts: row.attempts + 1,
        },
      ]);
    }
  }
  return cleared;
}

/** An outbox row back as the message it stands for. */
function outboxMessage(row: typeof schema.storageOutbox.$inferSelect): StorageMessage {
  return row.op === "r2_delete_prefix"
    ? { op: "r2_delete_prefix", prefix: row.target }
    : { op: row.op, key: row.target };
}

/* ---------------- consuming messages ---------------- */

function parseSlugKey(key: string) {
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
          // Suspension is enforced here and nowhere else (#67). Every
          // republish runs through this function, so a suspended link stays
          // dark through any later edit, rename, or alias change. A check in
          // the suspend route alone would be undone by the next save.
          isNull(schema.links.suspendedAt),
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
    // The org's grace period rides along, because a locked domain's verdict
    // is "serves until X" and the redirect path may not read D1 to find X
    // (#159). Left join: an org that has never been reconciled has no row,
    // and its domains serve.
    const rows = await db
      .select({
        domain: schema.domains,
        graceEndsAt: schema.orgEntitlements.graceEndsAt,
      })
      .from(schema.domains)
      .leftJoin(schema.orgEntitlements, eq(schema.orgEntitlements.orgId, schema.domains.orgId))
      .where(eq(schema.domains.hostname, hostname))
      .limit(1);
    const domain = rows[0]?.domain;
    if (!domain || domain.status !== "active") return null;
    return JSON.stringify({
      domainId: domain.id,
      orgId: domain.orgId,
      rootRedirect: domain.rootRedirect,
      // A locked domain with no grace on file has already run out: the
      // absence of a deadline must not read as "serves forever".
      servesUntil: domain.lockedAt === null ? null : (rows[0]?.graceEndsAt ?? domain.lockedAt),
    } satisfies KVDomain);
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
    const page = await env.MEDIA.list({ prefix, limit: R2_LIST_LIMIT });
    if (!page.objects.length) return;
    await env.MEDIA.delete(page.objects.map((object) => object.key));
  }
}

/* ---------------- user avatars ---------------- */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_PREFIX = "avatars/";
const AVATAR_SERVING_PATH = "/api/user/avatar";

/** The serving URL stored in `user.image`. Same for every user: the route
 * reads the object keyed by the session user, so the URL never embeds an
 * extension or a secret. */
export function avatarUrl(): string {
  return AVATAR_SERVING_PATH;
}

/**
 * Download a Google profile picture to R2 and return its serving URL.
 *
 * Runs at Google link/re-login time (see better-auth.ts). Only Google's hosts
 * are accepted, and only raster JPEG/PNG (SVG is a script surface). A picture
 * that fails any check is skipped rather than throwing, so a bad profile can
 * never break sign-in. Returns null when nothing was stored.
 */
export async function storeUserAvatar(
  env: Env,
  userId: string,
  pictureUrl: string | null | undefined,
): Promise<string | null> {
  if (!pictureUrl) return null;
  let url: URL;
  try {
    url = new URL(pictureUrl);
  } catch {
    return null;
  }
  // Only Google's avatar hosts, or the local emulator's host in dev (which
  // serves over http, so the protocol check is relaxed for it).
  const googleHost = /^lh[0-9a-z.-]*\.googleusercontent\.com$/i;
  const emulatorHost = env.GOOGLE_EMULATOR_URL
    ? (() => {
        try {
          return new URL(env.GOOGLE_EMULATOR_URL).host;
        } catch {
          return "";
        }
      })()
    : "";
  const isEmulator = Boolean(emulatorHost) && url.host === emulatorHost;
  if (!isEmulator && url.protocol !== "https:") return null;
  if (!(googleHost.test(url.hostname) || isEmulator)) return null;

  let resp: Response;
  try {
    resp = await fetch(pictureUrl);
  } catch {
    // A failed download must never break sign-in; the blobatar stays.
    return null;
  }
  if (!resp.ok) return null;
  const type = (resp.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "image/jpeg" && type !== "image/png") return null;
  let body: ArrayBuffer;
  try {
    body = await resp.arrayBuffer();
  } catch {
    return null;
  }
  if (body.byteLength === 0 || body.byteLength > AVATAR_MAX_BYTES) return null;

  try {
    const key = `${AVATAR_PREFIX}${userId}`;
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
  } catch {
    return null;
  }
  return avatarUrl();
}

/** Remove a user's avatar bytes (called on account deletion). */
export async function deleteUserAvatar(env: Env, userId: string): Promise<void> {
  await env.MEDIA.delete(`${AVATAR_PREFIX}${userId}`);
  await enqueueStorage(env, [{ op: "r2_delete_prefix", prefix: `${AVATAR_PREFIX}${userId}` }]);
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
    const page = await env.MEDIA.list({ cursor, limit: R2_LIST_LIMIT });
    const orphans = page.objects.flatMap((object) =>
      object.uploaded.getTime() < cutoff &&
      !referenced.has(object.key) &&
      !object.key.startsWith(AVATAR_PREFIX)
        ? [object.key]
        : [],
    );
    if (orphans.length) {
      await env.MEDIA.delete(orphans);
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
      await env.MEDIA.delete(message.key);
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
        Sentry.captureException(error, {
          extra: { op: message.body.op, target: targetOf(message.body) },
        });
        if (message.attempts >= STORAGE_MAX_DELIVERIES) {
          console.error("storage_message_dead_letter", message.body.op, targetOf(message.body));
        }
        message.retry();
      }
    }),
  );
}

/**
 * Consume the dead-letter queue: record the work, alert, then ack.
 *
 * A message reaching this point means Cloudflare Queues gave up on it after
 * every retry. It used to be alerted on and dropped, with only `op` and
 * `target` in the alert, so the change could not be replayed even by hand
 * (#118). It now goes to the outbox first, which is the same two fields plus
 * somewhere for the daily drain to find them.
 */
export async function logDeadLetterBatch(
  env: Env,
  batch: MessageBatch<StorageMessage>,
): Promise<void> {
  const recorded = await recordOutbox(
    env,
    batch.messages.map((message) => message.body),
    "gave_up",
  );
  captureAlert(
    batch.messages.map((message) => ({
      event: "storage_message_gave_up",
      op: message.body.op,
      target: targetOf(message.body),
    })),
  );
  // The outbox row is the only record left of this work, so acknowledging a
  // message whose row did not persist discards it for good. A transient D1
  // failure earns a redelivery instead.
  if (!recorded) {
    batch.retryAll();
    return;
  }
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
