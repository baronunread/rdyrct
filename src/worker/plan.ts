import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { PLAN_LIMITS, type OrgPlan, type PlanLimits } from "@/shared/types";

/**
 * Runs one raw D1 statement and reports whether it wrote a row. Meant for a
 * conditional INSERT/UPDATE whose WHERE clause re-checks a COUNT(*) subquery:
 * D1 executes a single statement as one atomic unit no concurrent request can
 * interleave with, which closes the classic count-then-write race a
 * count-query-then-separate-insert pair leaves open.
 */
async function runGuarded(env: Env, sql: string, bindings: unknown[]): Promise<boolean> {
  const result = await env.DB.prepare(sql)
    .bind(...bindings)
    .run();
  return result.meta.changes > 0;
}

/** Converts a Drizzle query into a raw D1 prepared statement, so a
 * type-checked builder can still take part in a batch built from raw
 * conditional SQL (D1 batch() takes D1PreparedStatement[], not a mix of
 * Drizzle query builders and raw SQL). */
function toD1Statement(env: Env, query: { sql: string; params: unknown[] }) {
  return env.DB.prepare(query.sql).bind(...query.params);
}

/**
 * Creates an org and its owner membership: the owner-membership row only
 * writes if the caller is still under their owned-org cap at write time
 * (re-checked inside its own statement, not from a value fetched earlier).
 * All three statements — the org insert, the guarded membership insert, and
 * a compensating delete that only fires when the guard found no room — run
 * in one D1 batch (one atomic transaction), so no org ever persists without
 * an owner (see issue #18) and the compensation can't itself fail as a
 * separate, non-atomic follow-up call.
 */
export async function createOwnedOrg(
  db: DB,
  env: Env,
  args: { orgId: string; userId: string; name: string; ts: number; ownedOrgLimit: number },
): Promise<boolean> {
  const orgInsert = db
    .insert(schema.orgs)
    .values({ id: args.orgId, name: args.name, createdAt: args.ts })
    .toSQL();
  const results = await env.DB.batch([
    toD1Statement(env, orgInsert),
    env.DB.prepare(
      `insert into org_members (org_id, user_id, role, created_at)
       select ?, ?, 'owner', ?
       where (select count(*) from org_members where user_id = ? and role = 'owner') < ?`,
    ).bind(args.orgId, args.userId, args.ts, args.userId, args.ownedOrgLimit),
    env.DB.prepare(
      `delete from orgs where id = ? and not exists (select 1 from org_members where org_id = ?)`,
    ).bind(args.orgId, args.orgId),
  ]);
  return results[1].meta.changes > 0;
}

/**
 * Accepts an invite: writes the membership row only if the caller isn't
 * already a member and the org is still under its member cap, both re-checked
 * inside this one statement. Closes the race where two concurrent accepts
 * (or one accept retried twice) both pass separate pre-checks.
 */
export async function acceptInviteAtomically(
  env: Env,
  args: {
    orgId: string;
    userId: string;
    role: "admin" | "member";
    ts: number;
    memberLimit: number;
  },
): Promise<boolean> {
  return runGuarded(
    env,
    `insert into org_members (org_id, user_id, role, created_at)
     select ?, ?, ?, ?
     where not exists (select 1 from org_members where org_id = ? and user_id = ?)
       and (select count(*) from org_members where org_id = ?) < ?`,
    [
      args.orgId,
      args.userId,
      args.role,
      args.ts,
      args.orgId,
      args.userId,
      args.orgId,
      args.memberLimit,
    ],
  );
}

/** Builds (without executing) the conditional link_addresses insert used by
 * both insertAddressWithinLimit and insertLinkWithinLimit below: a
 * primary/permanent_alias row only writes if the org is still under its
 * `links` cap at write time, re-checked inside this one statement. */
/**
 * Bind values for a link_addresses row, in column order.
 *
 * These statements are raw SQL, so Drizzle never gets a chance to apply the
 * schema's defaults: whatever is in the object reaches `bind()` as-is, and
 * D1 rejects `undefined` outright ("D1_TYPE_ERROR: Type 'undefined' not
 * supported"). Four of these columns are optional in `$inferInsert`, so a
 * caller that builds the row inline instead of through `newAddressRow` would
 * fail at runtime rather than at the type level. Normalizing here matches
 * what insertDomainWithinLimit below already does.
 */
function addressColumns(address: typeof schema.linkAddresses.$inferInsert) {
  return [
    address.id,
    address.linkId,
    address.orgId,
    address.domainId ?? null,
    address.slug,
    address.kind,
    address.creationReason ?? "",
    address.expiresAt ?? null,
    address.retiredAt ?? null,
    address.createdAt,
  ];
}

function guardedAddressInsertStatement(
  env: Env,
  address: typeof schema.linkAddresses.$inferInsert,
  linkLimit: number,
) {
  const columns = addressColumns(address);
  return env.DB.prepare(
    `insert into link_addresses
       (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at)
     select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     where (
       select count(*) from link_addresses
       where org_id = ? and retired_at is null and kind in ('primary', 'permanent_alias')
     ) < ?`,
  ).bind(...columns, address.orgId, linkLimit);
}

/**
 * Inserts a link_addresses row, honoring the org's `links` cap atomically: a
 * temp_alias never counts toward that cap (see countActiveAddresses) and
 * always writes; a primary/permanent_alias row only writes if the org is
 * still under its cap at write time, re-checked inside this one statement.
 */
export async function insertAddressWithinLimit(
  env: Env,
  address: typeof schema.linkAddresses.$inferInsert,
  linkLimit: number,
): Promise<boolean> {
  if (address.kind === "temp_alias") {
    // Unconditional insert (a temp_alias never counts toward the cap): it
    // either writes the row or throws, so `changes` is always > 0. Returning
    // the guard's own result (rather than a hardcoded true) keeps this
    // honest if the statement ever gains a WHERE clause.
    return runGuarded(
      env,
      `insert into link_addresses
         (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      addressColumns(address),
    );
  }
  const result = await guardedAddressInsertStatement(env, address, linkLimit).run();
  return result.meta.changes > 0;
}

/**
 * Creates a link and its primary address: the address only writes if the org
 * is still under its `links` cap at write time. All three statements — the
 * link insert, the guarded primary-address insert, and a compensating
 * delete that only fires when the guard found no room — run in one D1 batch,
 * so no link ever persists without its primary address (see issue #18) and
 * the compensation can't itself fail as a separate, non-atomic follow-up
 * call.
 */
export async function insertLinkWithinLimit(
  db: DB,
  env: Env,
  link: typeof schema.links.$inferInsert,
  address: typeof schema.linkAddresses.$inferInsert,
  linkLimit: number,
): Promise<boolean> {
  const linkInsert = db.insert(schema.links).values(link).toSQL();
  const results = await env.DB.batch([
    toD1Statement(env, linkInsert),
    guardedAddressInsertStatement(env, address, linkLimit),
    env.DB.prepare(
      `delete from links where id = ? and not exists (select 1 from link_addresses where link_id = ?)`,
    ).bind(link.id, link.id),
  ]);
  return results[1].meta.changes > 0;
}

/**
 * Flips a temp_alias to permanent_alias (see "keep forever"), honoring the
 * org's `links` cap atomically: the row only becomes newly-counted if the org
 * is still under its cap at write time.
 */
export async function keepAddressForeverWithinLimit(
  env: Env,
  args: { addressId: string; orgId: string; linkLimit: number },
): Promise<boolean> {
  return runGuarded(
    env,
    `update link_addresses set kind = 'permanent_alias', expires_at = null
     where id = ? and retired_at is null and kind = 'temp_alias'
       and (
         select count(*) from link_addresses
         where org_id = ? and retired_at is null and kind in ('primary', 'permanent_alias')
       ) < ?`,
    [args.addressId, args.orgId, args.linkLimit],
  );
}

/**
 * Inserts a domain row honoring the org's `domains` cap atomically: only
 * writes if the org is still under its cap at write time.
 */
export async function insertDomainWithinLimit(
  env: Env,
  row: typeof schema.domains.$inferInsert,
  domainLimit: number,
): Promise<boolean> {
  return runGuarded(
    env,
    `insert into domains
       (id, org_id, hostname, status, status_reason, root_redirect, cf_hostname_id, created_at)
     select ?, ?, ?, ?, ?, ?, ?, ?
     where (select count(*) from domains where org_id = ?) < ?`,
    [
      row.id,
      row.orgId,
      row.hostname,
      row.status ?? "checking_dns",
      row.statusReason ?? "",
      row.rootRedirect ?? "",
      row.cfHostnameId ?? null,
      row.createdAt,
      row.orgId,
      domainLimit,
    ],
  );
}

/**
 * An org's plan = its owner's plan. Billing is per-user (a person holds one
 * Free/Hobby/Pro subscription), so an org's effective limits come from whoever owns
 * it: resolve the owner membership and read that user's plan.
 */
export async function orgPlan(
  db: DB,
  orgId: string,
): Promise<{ plan: OrgPlan; limits: PlanLimits }> {
  const rows = await db
    .select({ plan: schema.user.plan })
    .from(schema.orgMembers)
    .innerJoin(schema.user, eq(schema.orgMembers.userId, schema.user.id))
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.role, "owner")));
  const plan = rows[0]?.plan ?? "free";
  return { plan, limits: PLAN_LIMITS[plan] };
}

/**
 * How many addresses in this org count toward its `links` plan limit: every
 * link's primary address plus every alias a user chose to keep forever. A
 * rename's automatic 48h temp_alias never counts (see #38) — it's excluded
 * by `kind`, not by any caller-side special case, so every gate (new link,
 * same-destination merge, "keep forever") can share this one count.
 */
export async function countActiveAddresses(db: DB, orgId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.linkAddresses)
    .where(
      and(
        eq(schema.linkAddresses.orgId, orgId),
        isNull(schema.linkAddresses.retiredAt),
        inArray(schema.linkAddresses.kind, ["primary", "permanent_alias"]),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** A user's own subscription: gates multi-org creation and the billing tab. */
export async function userPlan(
  db: DB,
  userId: string,
): Promise<{ plan: OrgPlan; limits: PlanLimits }> {
  const rows = await db
    .select({ plan: schema.user.plan })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const plan = rows[0]?.plan ?? "free";
  return { plan, limits: PLAN_LIMITS[plan] };
}
