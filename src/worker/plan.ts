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

/**
 * Creates an org and its owner membership: the org row always writes, but the
 * owner-membership row only writes if the caller is still under their
 * owned-org cap at write time (re-checked inside this one statement, not from
 * a value fetched earlier). If the cap was hit, the org row is rolled back by
 * hand so no org ever persists without an owner (see issue #18).
 */
export async function createOwnedOrg(
  db: DB,
  env: Env,
  args: { orgId: string; userId: string; name: string; ts: number; ownedOrgLimit: number },
): Promise<boolean> {
  await db.insert(schema.orgs).values({ id: args.orgId, name: args.name, createdAt: args.ts });
  const gotOwnership = await runGuarded(
    env,
    `insert into org_members (org_id, user_id, role, created_at)
     select ?, ?, 'owner', ?
     where (select count(*) from org_members where user_id = ? and role = 'owner') < ?`,
    [args.orgId, args.userId, args.ts, args.userId, args.ownedOrgLimit],
  );
  if (!gotOwnership) await db.delete(schema.orgs).where(eq(schema.orgs.id, args.orgId));
  return gotOwnership;
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
  const columns = [
    address.id,
    address.linkId,
    address.orgId,
    address.domainId,
    address.slug,
    address.kind,
    address.creationReason,
    address.expiresAt,
    address.retiredAt,
    address.createdAt,
  ];
  if (address.kind === "temp_alias") {
    await runGuarded(
      env,
      `insert into link_addresses
         (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      columns,
    );
    return true;
  }
  return runGuarded(
    env,
    `insert into link_addresses
       (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at)
     select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     where (
       select count(*) from link_addresses
       where org_id = ? and retired_at is null and kind in ('primary', 'permanent_alias')
     ) < ?`,
    [...columns, address.orgId, linkLimit],
  );
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
