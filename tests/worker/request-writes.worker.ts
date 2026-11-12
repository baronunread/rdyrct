import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import {
  applyTestMigrations,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  recordingEnv,
} from "./support";
import type { ApiKeyDTO } from "../../src/shared/types";

/**
 * What a signed-in request writes to D1 on its way through withSession
 * (#489). Every request used to queue an update of the account's last-seen
 * mark, and every API-key request an update of the key's last-used mark,
 * whether or not either had anything to change. The marks are read with the
 * caller, so a fresh one now means no statement at all.
 */

const HOUR_MS = 60 * 60 * 1000;

const seenWrites = (sql: string[]) =>
  sql.filter((q) => q.startsWith('update "user"') && q.includes('"last_seen_at"'));
const keyWrites = (sql: string[]) => sql.filter((q) => q.startsWith('update "api_keys"'));

async function setLastSeen(at: number | null) {
  await env.DB.prepare("update user set last_seen_at = ? where id = 'free-1'").bind(at).run();
}

async function lastSeen() {
  const row = await env.DB.prepare("select last_seen_at from user where id = 'free-1'").first<{
    last_seen_at: number | null;
  }>();
  return row?.last_seen_at ?? null;
}

describe("withSession's last-seen and last-used marks (#489)", () => {
  beforeEach(applyTestMigrations);
  afterEach(reset);

  describe("a session cookie", () => {
    async function getUser(cookie: string) {
      const recording = recordingEnv();
      const res = await fetchWorker(
        new Request("http://localhost/api/user", { headers: { cookie } }),
        recording.env,
      );
      expect(res.status).toBe(200);
      return recording.sql;
    }

    it("marks an account never seen before", async () => {
      const cookie = await freeOwnerCookie();
      await setLastSeen(null);

      expect(seenWrites(await getUser(cookie))).toHaveLength(1);
      expect(await lastSeen()).toBeGreaterThan(Date.now() - HOUR_MS);
    });

    it("sends no write when the mark is under an hour old", async () => {
      const cookie = await freeOwnerCookie();
      const recent = Date.now() - HOUR_MS / 2;
      await setLastSeen(recent);

      expect(seenWrites(await getUser(cookie))).toHaveLength(0);
      expect(await lastSeen()).toBe(recent);
    });

    it("writes again once the mark is over an hour old", async () => {
      const cookie = await freeOwnerCookie();
      const stale = Date.now() - 2 * HOUR_MS;
      await setLastSeen(stale);

      expect(seenWrites(await getUser(cookie))).toHaveLength(1);
      expect(await lastSeen()).toBeGreaterThan(stale);
    });
  });

  describe("an API key", () => {
    async function mintKey() {
      const cookie = await freeOwnerCookie();
      const minted = await fetchWorker(
        new Request("http://localhost/api/orgs/org-1/api-keys", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "connector" }),
        }),
      );
      expect(minted.status).toBe(201);
      return jsonBody<ApiKeyDTO>(minted);
    }

    async function useKey(key: ApiKeyDTO) {
      const recording = recordingEnv();
      const res = await fetchWorker(
        new Request("http://localhost/api/orgs/org-1/links", {
          headers: { authorization: `Bearer ${key.key}` },
        }),
        recording.env,
      );
      expect(res.status).toBe(200);
      return recording.sql;
    }

    async function setLastUsed(id: string, at: number | null) {
      await env.DB.prepare("update api_keys set last_used_at = ? where id = ?").bind(at, id).run();
    }

    async function lastUsed(id: string) {
      const row = await env.DB.prepare("select last_used_at from api_keys where id = ?")
        .bind(id)
        .first<{ last_used_at: number | null }>();
      return row?.last_used_at ?? null;
    }

    it("records a key's first use at once", async () => {
      const key = await mintKey();

      expect(keyWrites(await useKey(key))).toHaveLength(1);
      expect(await lastUsed(key.id)).toBeGreaterThan(Date.now() - HOUR_MS);
    });

    it("sends no write for a key used in the last five minutes", async () => {
      const key = await mintKey();
      const recent = Date.now() - 60 * 1000;
      await setLastUsed(key.id, recent);
      await setLastSeen(Date.now());

      const sql = await useKey(key);

      expect(keyWrites(sql)).toHaveLength(0);
      // The account was seen a moment ago too, so the request writes nothing.
      expect(seenWrites(sql)).toHaveLength(0);
      expect(await lastUsed(key.id)).toBe(recent);
    });

    it("writes again once the mark is over five minutes old", async () => {
      const key = await mintKey();
      const stale = Date.now() - 10 * 60 * 1000;
      await setLastUsed(key.id, stale);

      expect(keyWrites(await useKey(key))).toHaveLength(1);
      expect(await lastUsed(key.id)).toBeGreaterThan(stale);
    });

    it("marks the key's account as seen, through the row the key was read with", async () => {
      const key = await mintKey();
      await setLastSeen(Date.now() - 2 * HOUR_MS);

      expect(seenWrites(await useKey(key))).toHaveLength(1);
    });
  });
});
