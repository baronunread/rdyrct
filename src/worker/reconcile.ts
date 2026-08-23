import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { countActiveAddresses } from "./plan";
import { enqueueStorage, syncDomainMsg } from "./storage";
import { sendEmail } from "./email";
import { renderEmail } from "./email-layout";
import { captureAlert } from "./sentry";
import {
  GRACE_PERIOD_MS,
  GRACE_WARNING_MS,
  PLAN_LIMITS,
  isOverLimit,
  orgPlanOf,
  type OrgPlan,
  type OverLimits,
  type PlanLimits,
} from "@/shared/types";

/**
 * What a plan change means for the orgs a user owns (#158).
 *
 * Nothing here deletes and nothing here demotes an owner. It records what is
 * over cap, marks which resources are locked, and lets the later slices act
 * on those marks: `orgs.lockedAt` refuses writes in requireOrgRole,
 * `domains.lockedAt` plus the org's `graceEndsAt` become the redirect path's
 * verdict in KV, and `orgMembers.previousRole` is what an upgrade reads to
 * put everybody back.
 *
 * Idempotent by construction. Every decision is recomputed from the live
 * rows, and the one value that could drift — when the grace ends — is only
 * moved when the plan the last pass compared against is not the plan this
 * one sees. Running it twice for the same plan changes nothing.
 */

/** The over-limit map as stored, parsed back with anything unrecognised dropped. */
export function parseOver(json: string): OverLimits {
  // SAFETY: written by writeEntitlement below, which stringifies an
  // OverLimits. A row hand-edited into something else reads back as a
  // partial object of numbers, and each field is checked before use.
  const raw = JSON.parse(json || "{}") as Record<string, unknown>;
  const over: OverLimits = {};
  for (const key of ["links", "members", "domains"] as const) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) over[key] = value;
  }
  return over;
}

/** The orgs a user owns, oldest first, which is the order every default here
 * follows: longest-standing keeps working. */
async function ownedOrgs(db: DB, userId: string) {
  return db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
      lockedAt: schema.orgs.lockedAt,
    })
    .from(schema.orgMembers)
    .innerJoin(schema.orgs, eq(schema.orgMembers.orgId, schema.orgs.id))
    .where(and(eq(schema.orgMembers.userId, userId), eq(schema.orgMembers.role, "owner")))
    .orderBy(asc(schema.orgs.createdAt), asc(schema.orgs.id));
}

async function setOrgLock(db: DB, orgId: string, lockedAt: number | null): Promise<void> {
  await db.update(schema.orgs).set({ lockedAt }).where(eq(schema.orgs.id, orgId));
}

/**
 * Which of the user's orgs stay active (#160).
 *
 * The owner's own choice is what is already in the column, so this only ever
 * moves the count: lock the newest active orgs when there are too many,
 * unlock the oldest locked ones when the plan allows more again. An owner who
 * unlocked their second org and locked their first keeps that arrangement
 * through every later pass.
 */
async function reconcileOrgLocks(
  db: DB,
  orgs: { id: string; lockedAt: number | null }[],
  limit: number,
  now: number,
): Promise<void> {
  const active = orgs.filter((o) => o.lockedAt === null);
  if (active.length > limit) {
    for (const org of active.slice(limit)) {
      await setOrgLock(db, org.id, now);
      org.lockedAt = now;
    }
    return;
  }
  const locked = orgs.filter((o) => o.lockedAt !== null);
  for (const org of locked.slice(0, limit - active.length)) {
    await setOrgLock(db, org.id, null);
    org.lockedAt = null;
  }
}

/**
 * Locks the domains beyond the org's cap, oldest kept (#159).
 *
 * Returns the hostnames whose verdict changed, so only those get a KV
 * republish: the value carries the deadline, so a domain whose lock did not
 * move needs no write.
 */
async function reconcileDomainLocks(
  db: DB,
  orgId: string,
  limit: number,
  now: number,
): Promise<{ count: number; changed: string[] }> {
  const rows = await db
    .select({
      id: schema.domains.id,
      hostname: schema.domains.hostname,
      lockedAt: schema.domains.lockedAt,
    })
    .from(schema.domains)
    .where(eq(schema.domains.orgId, orgId))
    .orderBy(asc(schema.domains.createdAt), asc(schema.domains.id));

  const changed: string[] = [];
  for (const [index, row] of rows.entries()) {
    const lockedAt = index < limit ? null : (row.lockedAt ?? now);
    if (lockedAt === row.lockedAt) continue;
    await db.update(schema.domains).set({ lockedAt }).where(eq(schema.domains.id, row.id));
    changed.push(row.hostname);
  }
  return { count: rows.length, changed };
}

/**
 * Demotes the members beyond the org's cap to viewer, and restores whoever
 * fits again (#161).
 *
 * Longest-standing keeps write access and the owner is always among them, so
 * the outcome does not depend on who happened to log in. Nobody is removed:
 * a viewer keeps their membership, their seat and everything they could read.
 */
async function reconcileMemberRoles(
  db: DB,
  orgId: string,
  limit: number,
): Promise<{ count: number; demoted: string[] }> {
  const rows = await db
    .select({
      userId: schema.orgMembers.userId,
      role: schema.orgMembers.role,
      previousRole: schema.orgMembers.previousRole,
    })
    .from(schema.orgMembers)
    .where(eq(schema.orgMembers.orgId, orgId))
    .orderBy(asc(schema.orgMembers.createdAt), asc(schema.orgMembers.userId));

  const owner = rows.find((r) => r.role === "owner");
  const rest = rows.filter((r) => r !== owner);
  const keep = new Set([
    ...(owner ? [owner.userId] : []),
    ...rest.slice(0, Math.max(0, limit - (owner ? 1 : 0))).map((r) => r.userId),
  ]);

  const demoted: string[] = [];
  for (const row of rows) {
    if (keep.has(row.userId)) {
      // Back inside the cap: whatever they were before the demotion, they are
      // again. A role an admin set by hand since has no previousRole, so this
      // never writes over a deliberate change.
      if (row.previousRole === null) continue;
      await db
        .update(schema.orgMembers)
        .set({ role: row.previousRole, previousRole: null })
        .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, row.userId)));
      continue;
    }
    if (row.role === "viewer") continue;
    await db
      .update(schema.orgMembers)
      .set({ role: "viewer", previousRole: row.role })
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, row.userId)));
    demoted.push(row.userId);
  }
  return { count: rows.length, demoted };
}

async function readEntitlement(db: DB, orgId: string) {
  const rows = await db
    .select()
    .from(schema.orgEntitlements)
    .where(eq(schema.orgEntitlements.orgId, orgId));
  return rows[0] ?? null;
}

/** One org's state after a pass, as the app reads it. */
export interface OrgEntitlement {
  over: OverLimits;
  graceEndsAt: number | null;
  /** When the day-0 email for this grace period went out; null while unsent. */
  notifiedAt: number | null;
}

/**
 * Reconciles one org against its owner's plan. Returns the state it wrote.
 */
export async function reconcileOrg(
  env: Env,
  db: DB,
  org: { id: string; name: string },
  plan: OrgPlan,
  limits: PlanLimits,
  now: number,
): Promise<OrgEntitlement> {
  const previous = await readEntitlement(db, org.id);
  // A plan change is what restarts the clock. Comparing the stored plan (not
  // a timestamp) is what keeps a repeat run from extending a grace period
  // that is already counting down.
  const planChanged = orgPlanOf(previous?.plan) !== plan || previous === null;

  const links = await countActiveAddresses(db, org.id);
  const domains = await reconcileDomainLocks(db, org.id, limits.domains, now);
  const members = await reconcileMemberRoles(db, org.id, limits.members);

  const over: OverLimits = {};
  if (links > limits.links) over.links = links;
  if (members.count > limits.members) over.members = members.count;
  if (domains.count > limits.domains) over.domains = domains.count;

  const stillOver = isOverLimit(over);
  const graceEndsAt = !stillOver
    ? null
    : planChanged || previous?.graceEndsAt == null
      ? now + GRACE_PERIOD_MS
      : previous.graceEndsAt;
  // The two emails belong to one grace period, so a new one starts unsent.
  const keepNotices = !planChanged && graceEndsAt !== null;
  const notifiedAt = keepNotices ? (previous?.notifiedAt ?? null) : null;

  await writeEntitlement(db, {
    orgId: org.id,
    plan,
    overJson: JSON.stringify(over),
    graceEndsAt,
    reconciledAt: now,
    notifiedAt,
    warnedAt: keepNotices ? (previous?.warnedAt ?? null) : null,
  });

  // After the row is written, so the KV value the sync reads carries this
  // pass's deadline rather than the one it replaced.
  await enqueueStorage(
    env,
    domains.changed.map((hostname) => syncDomainMsg(hostname)),
  );

  return { over, graceEndsAt, notifiedAt };
}

async function writeEntitlement(
  db: DB,
  row: typeof schema.orgEntitlements.$inferInsert,
): Promise<void> {
  await db
    .insert(schema.orgEntitlements)
    .values(row)
    .onConflictDoUpdate({ target: schema.orgEntitlements.orgId, set: row });
}

/**
 * Runs a pass over every org a user owns. Called after any billing event
 * that changes `plan`, and by the admin's manual run.
 *
 * Never throws into its caller: a webhook that 500s earns a retry, and ten
 * of those disable the endpoint. A reconciliation that failed is worth an
 * alert and another pass, not a lost billing event.
 */
export async function reconcileUser(
  env: Env,
  db: DB,
  userId: string,
  now = Date.now(),
): Promise<void> {
  try {
    const rows = await db
      .select({ plan: schema.user.plan })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    const plan = orgPlanOf(rows[0]?.plan);
    const limits = PLAN_LIMITS[plan];

    const orgs = await ownedOrgs(db, userId);
    await reconcileOrgLocks(db, orgs, limits.orgs, now);
    for (const org of orgs) {
      const state = await reconcileOrg(env, db, org, plan, limits, now);
      await notifyDowngrade(env, db, org, plan, state, now);
    }
  } catch (error) {
    captureAlert([{ event: "reconcile_failed", userId }]);
    console.error("reconcile_failed", userId, error);
  }
}

/* ---------------- the two emails ---------------- */

function overSentence(over: OverLimits, limits: PlanLimits): string {
  const parts: string[] = [];
  if (over.links !== undefined) parts.push(`${over.links} links (the plan allows ${limits.links})`);
  if (over.members !== undefined)
    parts.push(`${over.members} members (the plan allows ${limits.members})`);
  if (over.domains !== undefined)
    parts.push(
      limits.domains === 0
        ? `${over.domains} custom ${over.domains === 1 ? "domain" : "domains"} (this plan has none)`
        : `${over.domains} custom domains (the plan allows ${limits.domains})`,
    );
  return parts.join(", ");
}

function graceSentence(graceEndsAt: number | null, hasDomains: boolean): string[] {
  if (!graceEndsAt || !hasDomains) return [];
  const date = new Date(graceEndsAt).toUTCString().slice(0, 16);
  return [`Your custom domains keep redirecting until ${date}, then they stop.`];
}

/** Who to write to about an org: its owner. */
async function ownerEmail(db: DB, orgId: string): Promise<string | null> {
  const rows = await db
    .select({ email: schema.user.email })
    .from(schema.orgMembers)
    .innerJoin(schema.user, eq(schema.orgMembers.userId, schema.user.id))
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.role, "owner")));
  return rows[0]?.email ?? null;
}

async function sendDowngradeEmail(
  env: Env,
  db: DB,
  org: { id: string; name: string },
  plan: OrgPlan,
  state: OrgEntitlement,
  kind: "now" | "warning",
): Promise<boolean> {
  const to = await ownerEmail(db, org.id);
  if (!to) return false;
  const limits = PLAN_LIMITS[plan];
  const heading =
    kind === "now" ? `${org.name} is over its plan` : `${org.name} loses its custom domains soon`;
  const body = renderEmail({
    preheader: overSentence(state.over, limits),
    heading,
    paragraphs: [
      `${org.name} is on the ${plan} plan and holds ${overSentence(state.over, limits)}.`,
      "Nothing was deleted. Your links, members and numbers are all still there.",
      ...graceSentence(state.graceEndsAt, state.over.domains !== undefined),
      "Upgrade to put everything back, or leave it: over-limit resources stay read-only until you do.",
    ],
    cta: { label: "See your plan", url: `${env.APP_URL}/billing` },
  });
  await sendEmail(env, to, heading, body);
  return true;
}

/** The day-0 email: sent once per grace period, right after the pass that
 * started it. */
async function notifyDowngrade(
  env: Env,
  db: DB,
  org: { id: string; name: string },
  plan: OrgPlan,
  state: OrgEntitlement,
  now: number,
): Promise<void> {
  if (!isOverLimit(state.over) || state.notifiedAt !== null) return;
  if (!(await sendDowngradeEmail(env, db, org, plan, state, "now"))) return;
  await db
    .update(schema.orgEntitlements)
    .set({ notifiedAt: now })
    .where(eq(schema.orgEntitlements.orgId, org.id));
}

/**
 * The day-23 email, from the daily cron: every org whose grace has a week
 * left and has not been warned yet.
 *
 * A send failure leaves `warnedAt` null, so tomorrow's run tries again, and
 * the window is a week wide rather than a single day for the same reason.
 */
export async function sweepGraceWarnings(env: Env, db: DB, now = Date.now()): Promise<number> {
  const rows = await db
    .select({
      orgId: schema.orgEntitlements.orgId,
      name: schema.orgs.name,
      plan: schema.orgEntitlements.plan,
      overJson: schema.orgEntitlements.overJson,
      graceEndsAt: schema.orgEntitlements.graceEndsAt,
    })
    .from(schema.orgEntitlements)
    .innerJoin(schema.orgs, eq(schema.orgEntitlements.orgId, schema.orgs.id))
    .where(
      and(
        isNull(schema.orgEntitlements.warnedAt),
        isNotNull(schema.orgEntitlements.graceEndsAt),
        lte(schema.orgEntitlements.graceEndsAt, now + GRACE_WARNING_MS),
        sql`${schema.orgEntitlements.graceEndsAt} > ${now}`,
      ),
    );

  let sent = 0;
  for (const row of rows) {
    const state = {
      over: parseOver(row.overJson),
      graceEndsAt: row.graceEndsAt,
      notifiedAt: null,
    };
    const org = { id: row.orgId, name: row.name };
    const delivered = await sendDowngradeEmail(
      env,
      db,
      org,
      orgPlanOf(row.plan),
      state,
      "warning",
    ).catch(() => false);
    if (!delivered) continue;
    await db
      .update(schema.orgEntitlements)
      .set({ warnedAt: now })
      .where(eq(schema.orgEntitlements.orgId, row.orgId));
    sent++;
  }
  return sent;
}
