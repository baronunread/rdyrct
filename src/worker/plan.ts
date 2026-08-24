import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { INVITABLE_ROLES, PLAN_LIMITS, type OrgPlan, type PlanLimits } from "@/shared/types";

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
 * Hands an org to its longest-standing remaining member.
 *
 * The account-deletion guard refuses to delete somebody who still owns an org
 * with other people in it, and it runs one query before the teardown runs
 * another. An invite accepted between the two turns a solo org into a shared
 * one after the refusal has already passed, so the teardown skips it, the
 * owner's membership goes with the account by cascade, and the org is left
 * with members and no owner: a state nothing in the product can express or
 * repair (#119).
 *
 * Promoting rather than refusing, because by this point the refusal is no
 * longer available: an error thrown from better-auth's `beforeDelete` escapes
 * its transaction wrapper as an unhandled rejection. Longest-standing is the
 * same default reconciliation already uses when it has to pick for somebody.
 *
 * One statement, so a second member joining while it runs cannot land between
 * a read and a write. Returns whether it promoted anyone: false means the org
 * was genuinely solo and belongs to the teardown instead.
 */
export async function promoteLongestStandingMember(
  env: Env,
  orgId: string,
  leavingUserId: string,
): Promise<boolean> {
  return runGuarded(
    env,
    `update org_members
     set role = 'owner'
     where org_id = ?
       and user_id = (
         select user_id from org_members
         where org_id = ? and user_id != ?
         order by created_at, user_id
         limit 1
       )`,
    [orgId, orgId, leavingUserId],
  );
}

/**
 * Accepts an invite: writes the membership row only if the token is still
 * live, the caller isn't already a member, and the org is under its member
 * cap. All three are re-checked inside the insert itself, and the invite is
 * spent in the same transaction, so the token is what admits exactly one
 * person rather than a row two requests can both read first (#154).
 *
 * The delete matches on the membership this call just wrote (org, user and
 * the exact `created_at` it was given) rather than on the token alone. That
 * is what keeps the two cases the insert refuses from spending the invite:
 * an org that filled up leaves the token usable once a seat frees, and a
 * member who opens somebody else's link does not burn it on their way to a
 * 409.
 *
 * The delete asks `changes() = 1`, which is SQLite for "the statement before
 * me wrote a row". That is the exact question, so the token is spent when
 * this call created the membership and never otherwise.
 *
 * It used to ask whether a membership existed with this request's exact
 * `created_at`, which is nearly the same question and not quite: a second
 * concurrent accept, correctly refused by the insert, still matched the row
 * the first accept had written in the same millisecond and spent its token
 * too (#156). `tests/worker/invite-accept.worker.ts` pins both the SQLite
 * behaviour and the race.
 */
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

/**
 * "This org is not being torn down", as a clause rather than as a read.
 *
 * `requireOrgRole` already refuses a write to an org that is deleting, but it
 * reads that flag before the handler runs. A create that passed the guard a
 * moment before `deleteOrg` set the flag still commits afterwards, and the
 * teardown's gather step has already taken its snapshot, so the address
 * survives as a public KV redirect for an org that is supposed to be gone
 * (#52). Inside the insert it is the same statement, so there is no window.
 */
const NOT_DELETING = "and not exists (select 1 from orgs where id = ? and deleting_at is not null)";

function guardedAddressInsertStatement(
  env: Env,
  address: typeof schema.linkAddresses.$inferInsert,
  linkLimit: number,
  addressLimit: number,
) {
  const columns = addressColumns(address);
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
     ${NOT_DELETING}`,
  ).bind(...columns, address.orgId, linkLimit, address.linkId, addressLimit, address.orgId);
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
  /** Active addresses one link may hold once this row lands, primary
   * included. Counted in the same statement as the org's cap, because a
   * read-then-insert lets two concurrent merges both find room and both
   * take it. */
  addressLimit: number,
): Promise<boolean> {
  if (address.kind === "temp_alias") {
    // A temp_alias never counts toward the cap, so the only thing that can
    // refuse it is the org being torn down. Returning the guard's own result
    // rather than a hardcoded true is what makes that refusal visible.
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
    // A brand-new link has no addresses yet, so the per-link ceiling cannot
    // bind here: 1 is the smallest value that always lets the primary land.
    guardedAddressInsertStatement(env, address, linkLimit, 1),
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
 * Makes one org the active one and locks whatever has to give way, in a
 * single D1 transaction (#160).
 *
 * Two requests picking two different locked orgs could otherwise both clear
 * `locked_at`, then both lock the org the other had just chosen, leaving an
 * owner with everything locked and no org they can write to. Batching the two
 * statements means the second one counts what the first one wrote, and no
 * concurrent request can interleave between them.
 *
 * The surplus is recomputed inside the statement rather than passed in, for
 * the same reason: a count read before the batch is a count that can be stale
 * by the time it is used.
 */
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
    // Newest first, and never the org being kept, which is what makes the
    // pick stick where reconciliation's by-age default would overrule it.
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

/**
 * Changes a member's role, refusing to hand out write access an org over its
 * member cap has no room for (#161).
 *
 * Guarded inside the statement, not from a count read first: two admins
 * promoting two different viewers at once would both find room and both take
 * it. Demoting to viewer is always allowed, and so is changing the role of
 * somebody who already writes, since neither adds a writer.
 *
 * `previous_role` is cleared only when the role actually moves. Confirming a
 * demoted member as `viewer` used to erase the record of what they were, so a
 * later upgrade silently left them a viewer: #29's "never delete" applies to
 * that record too.
 *
 * Returns false when the cap refused it, which is the only reason a matched
 * row goes unwritten: the caller has already checked the membership exists.
 */
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
