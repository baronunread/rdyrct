import { eq, inArray, sql } from "drizzle-orm";
import { parseLimitOverrides } from "@/shared/limits";
import type { LimitOverrides, PlanLimits } from "@/shared/types";
import * as schema from "./db/schema";
import type { DB } from "./env";
import { logFailure } from "./log-failure";

/**
 * Where an account's custom limits live: the `limit_overrides` table, one row
 * per limit that differs from the plan. Nothing else in the Worker reads or
 * writes it, so moving it changes this file and a migration and nothing else.
 *
 * The ways in: `loadLimitOverrides` and `loadAllLimitSettings` to read,
 * `saveLimitOverrides` to write, and `trackedClicksOverrideSql` for the one
 * query that has to compare a limit inside SQL (the usage email sweep).
 */

/** A PlanLimits key and the `limit_key` it is stored under. The one mapping. */
const COLUMNS = [
  ["orgs", "orgs"],
  ["links", "links"],
  ["members", "members"],
  ["domains", "domains"],
  ["qrCustom", "qr_custom"],
  ["analyticsDays", "analytics_days"],
  ["trackedClicks", "tracked_clicks"],
] as const satisfies readonly (readonly [keyof PlanLimits, string])[];

/** What an admin set for one account, and the record of it. */
export type LimitSetting = {
  overrides: LimitOverrides;
  note: string | null;
  /** The admin's user id. */
  setBy: string | null;
  setAt: number;
};

type Row = typeof schema.limitOverrides.$inferSelect;

/** Rows already reported as unreadable, so a bad one is logged once per
 * isolate and not on every request that reads it. */
const reported = new Set<string>();

/** The overrides a user's rows spell, as a candidate for the schema. */
function candidateOf(rows: Row[]) {
  return Object.fromEntries(
    COLUMNS.flatMap(([key, column]) => {
      const row = rows.find((r) => r.limitKey === column);
      return row ? [[key, key === "qrCustom" ? row.value === 1 : row.value] as const] : [];
    }),
  );
}

/** The note, who set it and when: every row of one save carries the same. */
function recordOf(rows: Row[]) {
  const first = rows[0];
  return { note: first?.note ?? null, setBy: first?.setBy ?? null, setAt: first?.setAt ?? 0 };
}

/** One user's rows as a setting. Rows that are not valid overrides are no
 * overrides: the account gets its plan's limits, which is the safe answer,
 * and the user is logged so somebody can repair the rows. */
function settingOf(userId: string, rows: Row[]): LimitSetting {
  const parsed = parseLimitOverrides(candidateOf(rows));
  if (!parsed && !reported.has(userId)) {
    reported.add(userId);
    logFailure("limit_overrides_unreadable", undefined, { userId });
  }
  return { overrides: parsed ?? {}, ...recordOf(rows) };
}

function group(rows: Row[]): Map<string, LimitSetting> {
  const byUser = new Map<string, Row[]>();
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row]);
  return new Map([...byUser].map(([userId, mine]) => [userId, settingOf(userId, mine)]));
}

/** D1 binds at most 100 parameters to one statement. */
const CHUNK = 50;

/** The overrides of each user asked for. A user with none has no entry, so
 * `map.get(id) ?? {}` is always the answer. */
export async function loadLimitOverrides(
  db: DB,
  userIds: readonly string[],
): Promise<Map<string, LimitOverrides>> {
  const ids = [...new Set(userIds)];
  const chunks = Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) =>
    ids.slice(i * CHUNK, (i + 1) * CHUNK),
  );
  const batches = await Promise.all(
    chunks.map((chunk) =>
      db.select().from(schema.limitOverrides).where(inArray(schema.limitOverrides.userId, chunk)),
    ),
  );
  const found = new Map<string, LimitOverrides>();
  for (const rows of batches)
    for (const [userId, setting] of group(rows)) found.set(userId, setting.overrides);
  return found;
}

/** Every user's setting, with its note and who set it, for the admin list. */
export async function loadAllLimitSettings(db: DB): Promise<Map<string, LimitSetting>> {
  return group(await db.select().from(schema.limitOverrides));
}

/**
 * Replaces a user's overrides with `overrides`, or clears them with null (an
 * empty object is none). Every row written carries the note and the admin who
 * set it. False when no such user exists.
 */
export async function saveLimitOverrides(
  db: DB,
  userId: string,
  overrides: LimitOverrides | null,
  record: { note?: string | null; setBy?: string | null } = {},
): Promise<boolean> {
  const exists = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  if (!exists[0]) return false;
  const setAt = Date.now();
  const rows = COLUMNS.flatMap(([key, column]) => {
    const value = overrides?.[key];
    if (value === undefined) return [];
    return [
      {
        userId,
        limitKey: column,
        value: Number(value),
        note: record.note ?? null,
        setBy: record.setBy ?? null,
        setAt,
      },
    ];
  });
  const clear = db.delete(schema.limitOverrides).where(eq(schema.limitOverrides.userId, userId));
  if (rows.length === 0) await clear;
  else await db.batch([clear, db.insert(schema.limitOverrides).values(rows)]);
  return true;
}

/** How many users hold custom limits, by their stored plan, for the admin
 * metrics: the paid ones among them are Enterprise. Banned people are left
 * out, as they are from the plan counts this is subtracted from. */
export async function countLimitHoldersByPlan(db: DB): Promise<{ plan: string; n: number }[]> {
  return db.all<{ plan: string; n: number }>(
    sql`select u.plan as plan, count(*) as n from user u
       where exists (select 1 from limit_overrides o where o.user_id = u.id)
         and u.banned = 0
       group by u.plan`,
  );
}

/**
 * A SQL expression for a user's custom monthly click count, or 0, given the
 * alias the query gives the `user` table. Zero on Free, where overrides do not
 * apply (see effectiveLimits). For the usage email sweep, which has to compare
 * a limit in SQL so its batch holds only orgs that are due.
 */
export function trackedClicksOverrideSql(userAlias: string): string {
  return `case when ${userAlias}.plan = 'free' then 0 else coalesce((
    select value from limit_overrides
    where user_id = ${userAlias}.id and limit_key = 'tracked_clicks'
  ), 0) end`;
}
