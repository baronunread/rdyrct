import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { INVITABLE_ROLES, type AccountTier, type OrgPlan, type PlanLimits } from "@/shared/types";
import { effectiveLimits, tierOf } from "@/shared/limits";
import { loadLimitOverrides } from "./limit-overrides";

// Set per request or job by configureBilling(): orgPlan() is called from ~20 places that only hold a db.
// Module state is fine because bindings are per deployment. Unset billing means nobody is capped.
let billingOn = true;
export function configureBilling(env: Env): void {
  billingOn = Boolean(env.POLAR_ACCESS_TOKEN || env.BILLING);
}
export const billingEnabled = () => billingOn;
export const planNow = (stored: OrgPlan): OrgPlan => (billingOn ? stored : "unlimited");

// D1 runs one statement atomically, so a conditional write that re-checks a COUNT(*) in its WHERE closes the count-then-write race.
async function runGuarded(env: Env, sql: string, bindings: unknown[]): Promise<boolean> {
  const result = await env.DB.prepare(sql)
    .bind(...bindings)
    .run();
  return result.meta.changes > 0;
}

// D1 batch() takes prepared statements, not Drizzle builders mixed with raw SQL.
export function toD1Statement(env: Env, query: { sql: string; params: unknown[] }) {
  return env.DB.prepare(query.sql).bind(...query.params);
}

// The guarded membership insert and a compensating delete run in one D1 batch, so no org persists without an owner (#18).
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

// changes() = 1 is SQLite for the statement before me wrote a row, so the token is spent only when this call created the membership:
// a full org or an existing member must not burn it (#154). Matching on created_at let a refused concurrent accept spend it too (#156).
export async function acceptInviteAtomically(
  env: Env,
  args: {
    orgId: string;
    userId: string;
    role: (typeof INVITABLE_ROLES)[number];
    ts: number;
    memberLimit: number;
    token: string;
  },
): Promise<boolean> {
  const results = await env.DB.batch([
    env.DB.prepare(
      `insert into org_members (org_id, user_id, role, created_at)
       select ?, ?, ?, ?
       where exists (select 1 from invites where token = ?)
         and not exists (select 1 from org_members where org_id = ? and user_id = ?)
         and (select count(*) from org_members where org_id = ?) < ?`,
    ).bind(
      args.orgId,
      args.userId,
      args.role,
      args.ts,
      args.token,
      args.orgId,
      args.userId,
      args.orgId,
      args.memberLimit,
    ),
    env.DB.prepare("delete from invites where token = ? and changes() = 1").bind(args.token),
  ]);
  return results[0].meta.changes > 0;
}

// Raw SQL gets no Drizzle defaults and D1 rejects undefined (D1_TYPE_ERROR), so normalize here.
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

// Inside the insert there is no window: a create that passed requireOrgRole just before deleteOrg set the flag would survive as a public KV redirect (#52).
const NOT_DELETING = "and not exists (select 1 from orgs where id = ? and deleting_at is not null)";

export function guardedAddressInsertStatement(
  env: Env,
  address: typeof schema.linkAddresses.$inferInsert,
  linkLimit: number,
  addressLimit: number,
  claimOf?: string,
) {
  const columns = addressColumns(address);
  // A claim awaits several calls after its expiry check. If the sweep removed the row and freed the slug meanwhile, the claim must fail: decided in this statement.
  const claim = claimOf ? "and exists (select 1 from anon_links where id = ?)" : "";
  return env.DB.prepare(
    `insert into link_addresses
       (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at)
     select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     where (
       select count(*) from link_addresses
       where org_id = ? and retired_at is null and kind in ('primary', 'permanent_alias')
     ) < ?
     and (
       select count(*) from link_addresses
       where link_id = ? and retired_at is null
     ) < ?
     ${NOT_DELETING}
     ${claim}`,
  ).bind(
    ...columns,
    address.orgId,
    linkLimit,
    address.linkId,
    addressLimit,
    address.orgId,
    ...(claimOf ? [claimOf] : []),
  );
}

// Same clause as the guarded inserts, so the two cannot drift (#52).
export const notDeletingSql = (orgId: string) =>
  sql`not exists (select 1 from ${schema.orgs} where ${schema.orgs.id} = ${orgId} and ${schema.orgs.deletingAt} is not null)`;

// Raw because a plain INSERT takes no WHERE and must ride the caller batch to stay atomic with the rename.
export function guardedTempAliasStatement(
  env: Env,
  address: typeof schema.linkAddresses.$inferInsert,
) {
  return env.DB.prepare(
    `insert into link_addresses
       (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at)
     select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     where 1 = 1 ${NOT_DELETING}`,
  ).bind(...addressColumns(address), address.orgId);
}

// A temp_alias never counts toward the cap (countActiveAddresses).
export async function insertAddressWithinLimit(
  env: Env,
  address: typeof schema.linkAddresses.$inferInsert,
  linkLimit: number,
  // Counted in the same statement: read-then-insert lets two concurrent merges both find room.
  addressLimit: number,
): Promise<boolean> {
  if (address.kind === "temp_alias") {
    // Returning the guard result, not true, makes the teardown refusal visible.
    return runGuarded(
      env,
      `insert into link_addresses
         (id, link_id, org_id, domain_id, slug, kind, creation_reason, expires_at, retired_at, created_at)
       select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       where 1 = 1 ${NOT_DELETING}`,
      [...addressColumns(address), address.orgId],
    );
  }
  const result = await guardedAddressInsertStatement(env, address, linkLimit, addressLimit).run();
  return result.meta.changes > 0;
}

// Guarded insert plus compensating delete in one D1 batch: no link persists without its primary address (#18).
export async function insertLinkWithinLimit(
  db: DB,
  env: Env,
  link: typeof schema.links.$inferInsert,
  address: typeof schema.linkAddresses.$inferInsert,
  linkLimit: number,
  claimOf?: string,
): Promise<boolean> {
  const linkInsert = db.insert(schema.links).values(link).toSQL();
  const results = await env.DB.batch([
    toD1Statement(env, linkInsert),
    // A new link has no addresses, so the per-link ceiling is 1, the smallest value that lets the primary land.
    guardedAddressInsertStatement(env, address, linkLimit, 1, claimOf),
    env.DB.prepare(
      `delete from links where id = ? and not exists (select 1 from link_addresses where link_id = ?)`,
    ).bind(link.id, link.id),
  ]);
  return results[1].meta.changes > 0;
}

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

export async function insertDomainWithinLimit(
  env: Env,
  row: typeof schema.domains.$inferInsert,
  domainLimit: number,
): Promise<boolean> {
  return runGuarded(
    env,
    `insert into domains
       (id, org_id, hostname, status, status_reason, root_redirect, cf_hostname_id, validation, created_at)
     select ?, ?, ?, ?, ?, ?, ?, ?, ?
     where (select count(*) from domains where org_id = ?) < ?
       ${NOT_DELETING}`,
    [
      row.id,
      row.orgId,
      row.hostname,
      row.status ?? "checking_dns",
      row.statusReason ?? "",
      row.rootRedirect ?? "",
      row.cfHostnameId ?? null,
      row.validation ?? "http",
      row.createdAt,
      row.orgId,
      domainLimit,
      row.orgId,
    ],
  );
}

// One transaction: two requests picking different locked orgs could each lock the other, leaving an owner nothing writable.
// The surplus is recomputed in the statement, not passed in (#160).
export async function keepOrgActive(
  env: Env,
  args: { orgId: string; userId: string; ownedOrgLimit: number; ts: number },
): Promise<void> {
  const ownedActive = `
    select o.id from orgs o
    join org_members m on m.org_id = o.id
    where m.user_id = ? and m.role = 'owner' and o.locked_at is null`;
  await env.DB.batch([
    env.DB.prepare(`update orgs set locked_at = null where id = ?`).bind(args.orgId),
    // Newest first, and never the org being kept, so the pick sticks over reconciliation by-age default.
    env.DB.prepare(
      `update orgs set locked_at = ?
       where id in (
         ${ownedActive} and o.id != ?
         order by o.created_at desc, o.id desc
         limit max(0, (select count(*) from (${ownedActive})) - ?)
       )`,
    ).bind(args.ts, args.userId, args.orgId, args.userId, args.ownedOrgLimit),
  ]);
}

// Guarded inside the statement: two admins promoting at once would both find room. previous_role is cleared only when the role moves,
// or confirming a viewer erases what they were (#29, #161). Returns false when the cap refused it.
export async function setMemberRoleWithinLimit(
  env: Env,
  args: {
    orgId: string;
    userId: string;
    role: (typeof INVITABLE_ROLES)[number];
    memberLimit: number;
  },
): Promise<boolean> {
  return runGuarded(
    env,
    `update org_members
     set role = ?, previous_role = case when role = ? then previous_role else null end
     where org_id = ? and user_id = ?
       and (
         ? = 'viewer'
         or role != 'viewer'
         or (select count(*) from org_members where org_id = ? and role != 'viewer') < ?
       )`,
    [args.role, args.role, args.orgId, args.userId, args.role, args.orgId, args.memberLimit],
  );
}

// Billing is per user: an org plan is its owner plan.
async function ownerUser(
  db: DB,
  orgId: string,
): Promise<{ id: string; plan: OrgPlan; email: string } | undefined> {
  const rows = await db
    .select({ id: schema.user.id, plan: schema.user.plan, email: schema.user.email })
    .from(schema.orgMembers)
    .innerJoin(schema.user, eq(schema.orgMembers.userId, schema.user.id))
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.role, "owner")));
  return rows[0];
}

export async function orgPlan(
  db: DB,
  orgId: string,
): Promise<{ plan: OrgPlan; limits: PlanLimits }> {
  const owner = await ownerUser(db, orgId);
  const plan = planNow(owner?.plan ?? "free");
  const overrides = owner ? (await loadLimitOverrides(db, [owner.id])).get(owner.id) : undefined;
  return { plan, limits: effectiveLimits(plan, overrides) };
}

export async function orgOwnerEmail(db: DB, orgId: string): Promise<string | null> {
  return (await ownerUser(db, orgId))?.email ?? null;
}

// A rename 48h temp_alias never counts (#38): excluded by kind, so every gate shares this count.
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

export async function userPlan(
  db: DB,
  userId: string,
): Promise<{ plan: OrgPlan; tier: AccountTier; limits: PlanLimits }> {
  const rows = await db
    .select({ plan: schema.user.plan })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const plan = planNow(rows[0]?.plan ?? "free");
  const overrides = rows[0] ? (await loadLimitOverrides(db, [userId])).get(userId) : undefined;
  return { plan, tier: tierOf(plan, overrides), limits: effectiveLimits(plan, overrides) };
}
