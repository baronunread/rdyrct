import * as Sentry from "@sentry/cloudflare";
import { eq, isNull, and, lt, ne, inArray, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { buildDestination, qrLogoKeyFromUrl, uid } from "./util";
import { captureAlert } from "./sentry";
import type { KVDomain, KVSlugValue } from "./kv";
import { logFailure } from "./log-failure";

/**
 * D1 is the source of truth; KV serves redirects, R2 stores QR logos. KV is written in the request: queueing left a new link 404ing and KV caching the miss (2026-10-05).
 * A StorageMessage must name a key, never carry a value, so replay is idempotent (tests/worker/storage-outbox.worker.ts).
 * A failed send or exhausted message writes a `storage_outbox` row after the D1 commit (#118).
 */

export type StorageMessage =
  | { op: "kv_sync"; key: string }
  | { op: "r2_delete"; key: string }
  | { op: "r2_delete_prefix"; prefix: string }
  // Names the org, not the keys, so it holds when the request that wanted it died before reading them.
  | { op: "org_sync"; orgId: string };

const R2_LIST_LIMIT = 1_000;

// Keep equal to the main queue's max_retries + 1 in wrangler.jsonc.
const STORAGE_MAX_DELIVERIES = 6;

const slugKey = (hostname: string | null, slug: string) =>
  hostname ? `slug:${hostname}:${slug}` : `slug:${slug}`;

const domainKey = (hostname: string) => `domain:${hostname}`;

export function syncLinkMsg(slug: string, hostname: string | null): StorageMessage {
  return { op: "kv_sync", key: slugKey(hostname, slug) };
}

export function syncDomainMsg(hostname: string): StorageMessage {
  return { op: "kv_sync", key: domainKey(hostname) };
}

export function deleteQrLogoMsg(url: string): StorageMessage | null {
  const key = qrLogoKeyFromUrl(url);
  return key ? { op: "r2_delete", key } : null;
}

/** `inlineLimit` is how many `kv_sync`s may be applied in the request before the whole batch goes to the queue. */
export async function enqueueStorage(
  env: Env,
  messages: Array<StorageMessage | null>,
  inlineLimit = INLINE_KV_SYNC_LIMIT,
): Promise<void> {
  const pending = await applyKvSyncs(
    env,
    messages.flatMap((m) => (m ? [m] : [])),
    inlineLimit,
  );
  const batch = pending.map((body) => ({ body }));
  if (!batch.length) return;
  try {
    await env.STORAGE_QUEUE.sendBatch(batch);
  } catch (error) {
    // D1 is already committed: without the outbox KV would serve the old value with nothing scheduled to fix it (#118).
    const recorded = await recordOutbox(
      env,
      batch.map((entry) => entry.body),
      "send_failed",
      // Narrowed where it arrives: a caught value is a string worth keeping only when it is an Error.
      error instanceof Error ? error.message.slice(0, 500) : "",
    );
    // The outbox row is the durable record and the mutation did commit, so a 500 would be a lie (#227).
    // Alert anyway. Rethrow only when the outbox write failed too: then the work is gone.
    if (recorded !== null) {
      captureAlert([
        {
          event: "storage_send_failed",
          count: batch.length,
          error: error instanceof Error ? error.message.slice(0, 200) : "",
        },
      ]);
      return;
    }
    throw error;
  }
}

const INLINE_KV_SYNC_LIMIT = 10;

/**
 * Only for a small batch (one link and its aliases) somebody is waiting on; a bulk change
 * would blow the subrequest budget. ponytail: two concurrent edits to one link can leave the
 * older KV value; a per-link Durable Object would close it.
 */
async function applyKvSyncs(
  env: Env,
  messages: StorageMessage[],
  inlineLimit: number,
): Promise<StorageMessage[]> {
  const db = drizzle(env.DB, { schema });
  const kv = messages.filter((m) => m.op === "kv_sync");
  if (kv.length > inlineLimit) return messages;
  const rest = messages.filter((m) => m.op !== "kv_sync");
  const results = await Promise.allSettled(kv.map((m) => kvSync(env, db, m.key)));
  return [...rest, ...kv.filter((_, i) => results[i]?.status === "rejected")];
}

/**
 * Never throws, but reports: the dead-letter consumer must not acknowledge a message whose
 * only remaining record failed to persist. A repeat failure replaces the pending row with a
 * fresh `id`, so a request arriving mid-drain is never removed unapplied.
 */
async function recordOutbox(
  env: Env,
  messages: StorageMessage[],
  reason: (typeof schema.storageOutbox.$inferSelect)["reason"],
  detail = "",
): Promise<string[] | null> {
  const now = Date.now();
  const ids = messages.map(() => uid());
  try {
    // Neither `created_at` nor `attempts` is reset on conflict: a key that fails daily would
    // otherwise look brand new each time and never accumulate the attempts that make it findable.
    await env.DB.batch(
      messages.map((message, i) =>
        env.DB.prepare(
          `insert into storage_outbox (id, op, target, reason, created_at, attempts, last_error)
           values (?, ?, ?, ?, ?, 0, ?)
           on conflict (op, target) do update set
             id = excluded.id,
             reason = excluded.reason,
             last_error = excluded.last_error`,
        ).bind(ids[i], message.op, targetOf(message), reason, now, detail),
      ),
    );
    return ids;
  } catch (writeError) {
    captureAlert([{ event: "storage_outbox_write_failed", reason, count: messages.length }]);
    logFailure("storage_outbox_write_failed", writeError, { reason });
    return null;
  }
}

/** Bounded so a large backlog costs several days rather than one cron run that times out. */
const OUTBOX_DRAIN_LIMIT = 200;

/** A day per attempt: a row that failed once drops behind newer work for about a day, however often the drain runs. */
export const OUTBOX_RETRY_BACKOFF = 24 * 60 * 60 * 1000;

/** Re-derives the value rather than replaying a captured one, so a late apply is correct. Returns how many rows it cleared. */
export async function drainStorageOutbox(env: Env): Promise<number> {
  const db = drizzle(env.DB, { schema });
  // Oldest first, each failed attempt counting as a day of age. By age alone, 200 rows that always fail
  // hold the limit forever; by attempts alone, a row that failed once never comes up again.
  // Built once for the filter and the order, so they cannot drift.
  const dueOrder = sql`${schema.storageOutbox.createdAt} + ${schema.storageOutbox.attempts} * ${sql.raw(String(OUTBOX_RETRY_BACKOFF))}`;
  const rows = await db
    .select()
    .from(schema.storageOutbox)
    // Excluded, not merely sorted last: otherwise a small outbox retries and re-alerts on a
    // failing row every drain instead of respecting its backoff.
    .where(sql`${dueOrder} <= ${Date.now()}`)
    .orderBy(dueOrder)
    .limit(OUTBOX_DRAIN_LIMIT);
  let cleared = 0;
  for (const row of rows) {
    try {
      await applyStorageMessage(env, db, outboxMessage(row));
      // `id` is the revision: a failure that arrived mid-apply does not match and survives.
      await db.delete(schema.storageOutbox).where(eq(schema.storageOutbox.id, row.id));
      cleared++;
    } catch (error) {
      // Left in place with its attempt count so a permanently broken row can be found.
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

function outboxMessage(row: typeof schema.storageOutbox.$inferSelect): StorageMessage {
  switch (row.op) {
    case "r2_delete_prefix":
      return { op: "r2_delete_prefix", prefix: row.target };
    case "org_sync":
      return { op: "org_sync", orgId: row.target };
    default:
      return { op: row.op, key: row.target };
  }
}

function parseSlugKey(key: string) {
  const rest = key.slice("slug:".length);
  const sep = rest.indexOf(":");
  // A slug and a hostname never hold a colon, so the first colon splits host from slug.
  if (sep === -1) return { hostname: null, slug: rest };
  return { hostname: rest.slice(0, sep), slug: rest.slice(sep + 1) };
}

/** The single definition of desired KV state, shared by the queue consumer and reconciliation. */
async function desiredKvValue(db: DB, key: string): Promise<string | null> {
  if (key.startsWith("slug:")) {
    const { hostname, slug } = parseSlugKey(key);
    const link = await desiredLink(db, slug, hostname);
    return link && JSON.stringify(link);
  }
  return desiredDomainValue(db, key);
}

/** For the redirect path while the queue's write has not landed yet (see `resolveLink` in index.ts). */
export async function desiredLink(
  db: DB,
  slug: string,
  hostname: string | null,
): Promise<KVSlugValue | null> {
  // Through link_addresses: a slug key names one active address, which answers with its parent link's
  // destination. An expired-but-unswept temp_alias still resolves here: index.ts's expiresAt check stops it.
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
      suspendedAt: schema.links.suspendedAt,
      warnedAt: schema.links.warnedAt,
      orgDisabledAt: schema.orgs.disabledAt,
    })
    .from(schema.linkAddresses)
    .innerJoin(schema.links, eq(schema.linkAddresses.linkId, schema.links.id))
    .leftJoin(schema.orgs, eq(schema.links.orgId, schema.orgs.id))
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
  // Suspension is enforced here and nowhere else (#67): every republish runs through this. Held,
  // not absent (#344): the key stays with no destination so redirects can say "under review".
  // A banned owner's org outranks a link's state: a ban is a decision, a suspension may be lifted.
  if (address.orgDisabledAt !== null)
    return { held: true, disabled: true, linkId: address.linkId, expiresAt: address.expiresAt };
  if (address.suspendedAt !== null)
    return { held: true, linkId: address.linkId, expiresAt: address.expiresAt };
  return {
    linkId: address.linkId,
    addressId: address.addressId,
    orgId: address.orgId,
    url: buildDestination(address.destination, address),
    expiresAt: address.expiresAt,
    // It rides in the value, so an edit cannot drop it and the redirect path needs no D1 read.
    ...(address.warnedAt !== null && { warn: true as const }),
  };
}

function domainKvValue({
  domain,
  graceEndsAt,
  orgDisabledAt,
}: {
  domain: typeof schema.domains.$inferSelect;
  graceEndsAt: number | null;
  orgDisabledAt: number | null;
}): KVDomain {
  return {
    // Not null, which would hand the host to the app.
    ...(orgDisabledAt !== null && { disabled: true as const }),
    domainId: domain.id,
    orgId: domain.orgId,
    rootRedirect: domain.rootRedirect,
    // No grace on file means it has run out: an absent deadline must not read as "serves forever".
    servesUntil: domain.lockedAt === null ? null : (graceEndsAt ?? domain.lockedAt),
  };
}

async function desiredDomainValue(db: DB, key: string): Promise<string | null> {
  if (key.startsWith("domain:")) {
    const hostname = key.slice("domain:".length);
    // A locked domain "serves until X" and the redirect path may not read D1 to find X (#159).
    // Left join: an org never reconciled has no row, and its domains serve.
    const rows = await db
      .select({
        domain: schema.domains,
        graceEndsAt: schema.orgEntitlements.graceEndsAt,
        orgDisabledAt: schema.orgs.disabledAt,
      })
      .from(schema.domains)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.domains.orgId))
      .leftJoin(schema.orgEntitlements, eq(schema.orgEntitlements.orgId, schema.domains.orgId))
      .where(eq(schema.domains.hostname, hostname))
      .limit(1);
    const row = rows[0];
    if (!row || row.domain.status !== "active") return null;
    return JSON.stringify(domainKvValue(row));
  }

  return null;
}

async function kvSync(env: Env, db: DB, key: string): Promise<void> {
  const value = await desiredKvValue(db, key);
  if (value === null) await env.LINKS.delete(key);
  else await env.LINKS.put(key, value);
}

export async function deleteR2Prefix(env: Env, prefix: string): Promise<void> {
  for (;;) {
    const page = await env.MEDIA.list({ prefix, limit: R2_LIST_LIMIT });
    if (!page.objects.length) return;
    await env.MEDIA.delete(page.objects.map((object) => object.key));
  }
}

// Margin for a Google-hosted photo pulled server-side; a Settings upload uses the stricter AVATAR_MAX_BYTES.
const AVATAR_FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_PREFIX = "avatars/";
const AVATAR_SERVING_PATH = "/api/user/avatar";

/** A `version` (upload time) changes the URL on replacement, so the browser refetches. */
export function avatarUrl(version?: string | number): string {
  return version === undefined
    ? AVATAR_SERVING_PATH
    : `${AVATAR_SERVING_PATH}?v=${encodeURIComponent(String(version))}`;
}

/** Null when there is no stored picture (a Google URL not yet copied into R2 would be blocked by the CSP). */
export function memberAvatarUrl(
  orgId: string,
  userId: string,
  image: string | null,
): string | null {
  if (!image?.startsWith(AVATAR_SERVING_PATH)) return null;
  const stamp = image.slice(AVATAR_SERVING_PATH.length);
  return `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/avatar${stamp}`;
}

function tryUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Google's avatar hosts over https, or the dev emulator's host (http). */
function avatarHostAllowed(url: URL, env: Env): boolean {
  const googleHost = /^lh[0-9a-z.-]*\.googleusercontent\.com$/i;
  const emulatorUrl = env.GOOGLE_EMULATOR_URL ? tryUrl(env.GOOGLE_EMULATOR_URL) : null;
  const isEmulator = emulatorUrl !== null && url.host === emulatorUrl.host;
  if (!isEmulator && url.protocol !== "https:") return false;
  return googleHost.test(url.hostname) || isEmulator;
}

/**
 * Runs at Google link/re-login (see better-auth.ts). Only raster JPEG/PNG (SVG is a
 * script surface). A picture that fails any check is skipped, never thrown, so a bad
 * profile cannot break sign-in.
 */
export async function storeUserAvatar(
  env: Env,
  userId: string,
  pictureUrl: string | null | undefined,
): Promise<string | null> {
  if (!pictureUrl) return null;
  const url = tryUrl(pictureUrl);
  if (!url || !avatarHostAllowed(url, env)) return null;

  let resp: Response;
  try {
    resp = await fetch(pictureUrl);
  } catch {
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
  if (body.byteLength === 0 || body.byteLength > AVATAR_FETCH_MAX_BYTES) return null;

  try {
    const key = `${AVATAR_PREFIX}${userId}`;
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
  } catch {
    return null;
  }
  return avatarUrl(Date.now());
}

export async function deleteUserAvatar(env: Env, userId: string): Promise<void> {
  await env.MEDIA.delete(`${AVATAR_PREFIX}${userId}`);
  await enqueueStorage(env, [{ op: "r2_delete_prefix", prefix: `${AVATAR_PREFIX}${userId}` }]);
}

/** Between upload and the row that references it an object is legitimately unreferenced: younger than this is an upload in progress (#49). */
const QR_LOGO_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * An abandoned upload leaves bytes with no owner, quota or delete path (#49). Only objects
 * older than the grace period are touched. ponytail: reads every referencing row into memory;
 * page against a per-org query if a logo stops being one short URL per link.
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

/** Throws on failure so the queue retries it. */
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
    case "org_sync":
      await republishOrg(env, db, message.orgId);
      return;
  }
}

function targetOf(message: StorageMessage): string {
  switch (message.op) {
    case "r2_delete_prefix":
      return message.prefix;
    case "org_sync":
      return message.orgId;
    default:
      return message.key;
  }
}

/**
 * A message on its last delivery logs `storage_message_dead_letter` so `wrangler tail`
 * shows what is about to dead-letter. Messages run concurrently: each is safe to apply
 * in any order.
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
          logFailure("storage_message_dead_letter", undefined, {
            op: message.body.op,
            target: targetOf(message.body),
          });
        }
        message.retry();
      }
    }),
  );
}

/** Before the outbox (#118) a dead-lettered message was alerted and dropped with only `op` and `target`. */
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
  // The outbox row is the only record left: acking a message whose row did not persist
  // discards it for good. A transient D1 failure earns a redelivery.
  if (recorded === null) {
    batch.retryAll();
    return;
  }
  for (const message of batch.messages) message.ack();
}

/** A link or domain created after this snapshot is rejected: `deleteOrg` has already marked the org deleting. */
export async function orgDeleteGather(
  db: DB,
  orgId: string,
): Promise<{ cfHostnameIds: string[]; kvKeys: string[] }> {
  const [domains, addresses] = await Promise.all([
    db
      .select({ hostname: schema.domains.hostname, cfHostnameId: schema.domains.cfHostnameId })
      .from(schema.domains)
      .where(eq(schema.domains.orgId, orgId)),
    // Aliases have their own KV key that a links-only gather would miss.
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

export async function deleteKvKeys(env: Env, keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => env.LINKS.delete(key)));
}

const REPUBLISH_BATCH = 100;

/**
 * Fixed round trips: one query and one send per link made a 3,000-link Pro org need
 * 3,002 D1 statements, past D1's per-invocation limit and the subrequest ceiling,
 * and the request died after the flag was committed. 3,000 links become 31 round trips.
 */
export async function republishOrgLinks(env: Env, db: DB, orgId: string): Promise<void> {
  const addresses = await db
    .select({ slug: schema.linkAddresses.slug, hostname: schema.domains.hostname })
    .from(schema.linkAddresses)
    .innerJoin(schema.links, eq(schema.linkAddresses.linkId, schema.links.id))
    .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
    .where(and(eq(schema.links.orgId, orgId), isNull(schema.linkAddresses.retiredAt)));
  const batches: StorageMessage[][] = [];
  for (let i = 0; i < addresses.length; i += REPUBLISH_BATCH)
    batches.push(
      addresses.slice(i, i + REPUBLISH_BATCH).map((a) => syncLinkMsg(a.slug, a.hostname)),
    );
  await Promise.all(batches.map((batch) => enqueueStorage(env, batch)));
}

async function republishOrg(env: Env, db: DB, orgId: string): Promise<void> {
  const domains = await db
    .select({ hostname: schema.domains.hostname })
    .from(schema.domains)
    .where(eq(schema.domains.orgId, orgId));
  await Promise.all([
    republishOrgLinks(env, db, orgId),
    domains.length > 0 &&
      enqueueStorage(
        env,
        domains.map((d) => syncDomainMsg(d.hostname)),
      ),
  ]);
}

/**
 * Built to go in the same `db.batch` as the change, so the change and the record of
 * its unfinished KV work commit together. Place it before the change so `orgs` still
 * sees the rows as they were. Returns the ids for `publishOrgSyncs`.
 */
export function queueOrgSyncs(db: DB, orgs: SQL | undefined) {
  return db
    .insert(schema.storageOutbox)
    .select(
      db
        .select({
          id: sql<string>`lower(hex(randomblob(16)))`.as("id"),
          op: sql<"org_sync">`'org_sync'`.as("op"),
          target: schema.orgs.id,
          reason: sql<"pending">`'pending'`.as("reason"),
          createdAt: sql<number>`${Date.now()}`.as("created_at"),
          attempts: sql<number>`0`.as("attempts"),
          lastError: sql<string>`''`.as("last_error"),
        })
        .from(schema.orgs)
        .where(orgs),
    )
    .onConflictDoUpdate({
      target: [schema.storageOutbox.op, schema.storageOutbox.target],
      set: { id: sql`excluded.id`, reason: sql`excluded.reason` },
    })
    .returning({ id: schema.storageOutbox.id, orgId: schema.storageOutbox.target });
}

/** Never throws: a failed row stays for the drain, and the change has already committed. */
export async function publishOrgSyncs(
  env: Env,
  db: DB,
  rows: { id: string; orgId: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const results = await Promise.allSettled(rows.map((row) => republishOrg(env, db, row.orgId)));
  const done = rows.filter((_, i) => results[i]?.status === "fulfilled").map((row) => row.id);
  const failed = rows.length - done.length;
  if (failed > 0) captureAlert([{ event: "org_republish_failed", count: failed }]);
  if (done.length > 0)
    await db
      .delete(schema.storageOutbox)
      .where(inArray(schema.storageOutbox.id, done))
      .catch(() => {});
}

/**
 * Written in the request, past INLINE_KV_SYNC_LIMIT (#101): a suspension must not wait on a
 * stuck queue. `recheck` queues the same keys again, delayed, since an owner's edit read
 * just before the suspension could put the link back live. It carries keys, not values.
 */
export async function republishLink(
  env: Env,
  db: DB,
  linkId: string,
  { recheck = false } = {},
): Promise<number> {
  const synced = await republishLinks(env, db, [linkId], { recheck, inlineLimit: Infinity });
  return synced.get(linkId) ?? 0;
}

/** One address query, then sends of at most a hundred. A bigger batch than `inlineLimit` goes to the queue. */
export async function republishLinks(
  env: Env,
  db: DB,
  linkIds: string[],
  { recheck = false, inlineLimit = INLINE_KV_SYNC_LIMIT } = {},
): Promise<Map<string, number>> {
  const addresses = await db
    .select({
      linkId: schema.linkAddresses.linkId,
      slug: schema.linkAddresses.slug,
      hostname: schema.domains.hostname,
    })
    .from(schema.linkAddresses)
    .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
    .where(
      and(
        sql`${schema.linkAddresses.linkId} in (select value from json_each(${JSON.stringify(linkIds)}))`,
        isNull(schema.linkAddresses.retiredAt),
      ),
    );
  const synced = new Map<string, number>();
  for (const a of addresses) synced.set(a.linkId, (synced.get(a.linkId) ?? 0) + 1);
  if (addresses.length === 0) return synced;
  const messages = addresses.map((a) => syncLinkMsg(a.slug, a.hostname));
  const batches: StorageMessage[][] = [];
  for (let i = 0; i < messages.length; i += REPUBLISH_BATCH)
    batches.push(messages.slice(i, i + REPUBLISH_BATCH));
  const inline = messages.length <= inlineLimit ? Infinity : 0;
  await Promise.all(batches.map((batch) => enqueueStorage(env, batch, inline)));
  if (recheck) {
    const sends = await Promise.allSettled(
      batches.map((batch) =>
        env.STORAGE_QUEUE.sendBatch(
          batch.map((body) => ({ body })),
          { delaySeconds: RECHECK_DELAY_SECONDS },
        ),
      ),
    );
    const failed = sends.find((s) => s.status === "rejected");
    if (failed?.status === "rejected")
      captureAlert([
        {
          event: "storage_recheck_send_failed",
          count: messages.length,
          error: failed.reason instanceof Error ? failed.reason.message.slice(0, 200) : "",
        },
      ]);
  }
  return synced;
}

/** Past KV's one-write-per-second limit for a key, and past any racing edit. */
const RECHECK_DELAY_SECONDS = 60;

// sendBatch caps at 100 messages and this sweep sends one per expired row.
const ALIAS_SWEEP_BATCH_SIZE = 100;

/**
 * The redirect path already stops resolving an expired alias (the expiry is in its KV
 * value): this sweep catches D1 and KV up so the slug frees for reuse.
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
    // desiredKvValue now finds no active row, so this converges to a delete.
    await enqueueStorage(
      env,
      expired.map((a) => syncLinkMsg(a.slug, a.hostname)),
    );
    if (expired.length < ALIAS_SWEEP_BATCH_SIZE) return;
  }
}
