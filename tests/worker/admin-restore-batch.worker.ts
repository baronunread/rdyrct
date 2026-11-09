/**
 * Restoring a whole batch of links in one request (#14).
 *
 * The route took up to 200 ids and ran the single-link restore for each, at
 * once: a select, the banned-owner check, an update, the org's flags, the
 * address lookup, a KV write per address, a delayed queue send and an audit
 * insert, per link. At 200 links that is thousands of D1 statements and
 * subrequests, past the per-invocation limits, so the request died partway
 * with some links restored and the rest still suspended.
 *
 * These count what one restore costs, by statement and by call, rather than
 * waiting for a limit miniflare does not enforce.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../src/worker/db/schema";
import type { StorageMessage } from "../../src/worker/storage";
import {
  adminCookie,
  applyTestMigrations,
  authEnv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  overriding,
  rawAddressRow,
  rawLinkRow,
  stubQueue,
} from "./support";

const LINKS = 200;
const ADDRESSES_PER_LINK = 3;

afterEach(reset);

let cookie: string;
let ids: string[];

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
  await freeOwnerCookie();
  cookie = await adminCookie();
  const db = drizzle(env.DB, { schema });
  ids = Array.from({ length: LINKS }, (_, i) => `bulk-link-${i}`);
  const links = ids.map((id, i) =>
    rawLinkRow({
      id,
      orgId: "org-1",
      slug: `bulk-${i}`,
      destination: "https://example.com",
      createdAt: 0,
      suspendedAt: 1,
      suspendedBy: "admin-1",
      suspendReason: "sweep",
    }),
  );
  const addresses = ids.flatMap((id, i) =>
    Array.from({ length: ADDRESSES_PER_LINK }, (_, k) =>
      rawAddressRow({
        id: `${id}-addr-${k}`,
        linkId: id,
        orgId: "org-1",
        slug: k === 0 ? `bulk-${i}` : `bulk-${i}-alias-${k}`,
        kind: k === 0 ? "primary" : "permanent_alias",
        createdAt: 0,
      }),
    ),
  );
  // Small statements keep each insert under D1's 100 bound parameters.
  const writes = [
    ...links.map((row) => db.insert(schema.links).values(row)),
    ...chunk(addresses, 5).map((rows) => db.insert(schema.linkAddresses).values(rows)),
  ];
  // SAFETY: both lists are non-empty, so writes has the first entry batch() wants.
  await db.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
  await env.DB.prepare(
    "update orgs set links_suspended_at = 1, disabled_at = null where id = 'org-1'",
  ).run();
});

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** An env that counts D1 statements, KV calls and queue sends. */
function countingEnv() {
  const queued: StorageMessage[] = [];
  const counts = { statements: 0, kv: 0, queueSends: 0, queued };
  const realDb = env.DB;
  const realKv = env.LINKS;
  const queue = stubQueue<StorageMessage>((m) => counts.queued.push(m));
  const testEnv = {
    ...authEnv(),
    DB: overriding(realDb, {
      prepare: (query: string) => {
        counts.statements++;
        return realDb.prepare(query);
      },
    }),
    LINKS: overriding(realKv, {
      put: async (...args: Parameters<KVNamespace["put"]>) => {
        counts.kv++;
        return realKv.put(...args);
      },
    }),
    STORAGE_QUEUE: overriding(queue, {
      sendBatch: async (...args: Parameters<typeof queue.sendBatch>) => {
        counts.queueSends++;
        return queue.sendBatch(...args);
      },
    }),
  };
  return { counts, testEnv };
}

const restore = (body: string, testEnv = authEnv()) =>
  fetchWorker(
    new Request("http://localhost/api/admin/links/restore", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body,
    }),
    testEnv,
  );

const suspendedCount = async () =>
  (await env.DB.prepare(
    "select count(*) as n from links where org_id = 'org-1' and suspended_at is not null",
  ).first<{ n: number }>())!.n;

describe("restoring MAX_ROWS links at once", () => {
  it("restores, republishes and audits every link in a bounded number of calls", async () => {
    const { counts, testEnv } = countingEnv();
    const res = await restore(JSON.stringify({ ids }), testEnv);
    expect(res.status).toBe(200);
    expect(await jsonBody<{ count: number }>(res)).toEqual({ count: LINKS });
    expect(await suspendedCount()).toBe(0);

    // Every address is resynced, now or by the queue, and resynced again
    // after the delay that catches a racing owner edit.
    const keys = new Set(counts.queued.map((m) => (m.op === "kv_sync" ? m.key : "")));
    expect(keys.size).toBe(LINKS * ADDRESSES_PER_LINK);

    const { results } = await env.DB.prepare(
      "select target_id, detail from admin_actions where action = 'link.unsuspend'",
    ).all<{ target_id: string; detail: string }>();
    expect(results.map((r) => r.target_id).sort()).toEqual([...ids].sort());
    expect(JSON.parse(results[0]!.detail)).toMatchObject({ orgId: "org-1", addresses: 3 });

    // Before the fix: well over two thousand of each.
    expect(counts.statements).toBeLessThan(150);
    expect(counts.kv + counts.queueSends).toBeLessThan(50);
  });

  it("restores none of them when one id does not exist", async () => {
    const res = await restore(JSON.stringify({ ids: [...ids.slice(0, 10), "missing"] }));
    expect(res.status).toBe(404);
    expect(await suspendedCount()).toBe(LINKS);
  });

  it("restores none of them when the owner is banned", async () => {
    await env.DB.prepare("update orgs set disabled_at = 1 where id = 'org-1'").run();
    const res = await restore(JSON.stringify({ ids }));
    expect(res.status).toBe(409);
    expect(await suspendedCount()).toBe(LINKS);
  });
});
