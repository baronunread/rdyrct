import * as v from "valibot";
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
  type JsonValue,
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

/** The shape `over_json` holds. Parsed rather than asserted, because the
 * column is text and a row written by an older version of this file (or by
 * hand) must read back as "nothing over" rather than as fiction. */
const overSchema = v.object({
  links: v.optional(v.number()),
  members: v.optional(v.number()),
  domains: v.optional(v.number()),
});

/** The over-limit map as stored, with anything unrecognised dropped. */
export function parseOver(json: string): OverLimits {
  const parsed = v.safeParse(overSchema, jsonOrNull(json));
  return parsed.success ? parsed.output : {};
}

function jsonOrNull(json: string): JsonValue {
  try {
    // SAFETY: JSON.parse's return is typed `any`; JsonValue is what a parsed
    // JSON document can be, and overSchema is what checks it means what this
    // file needs.
    return JSON.parse(json || "{}") as JsonValue;
  } catch {
    return null;
  }
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
  const [moving, lockedAt] =
    active.length > limit
      ? [active.slice(limit), now]
      : [orgs.filter((o) => o.lockedAt !== null).slice(0, limit - active.length), null];
  // Independent single-row updates, so they go out together rather than one
  // round trip at a time.
  await Promise.all(
    moving.map(async (org) => {
      await setOrgLock(db, org.id, lockedAt);
      org.lockedAt = lockedAt;
    }),
  );
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

  const moving = rows.flatMap((row, index) => {
    const lockedAt = index < limit ? null : (row.lockedAt ?? now);
    return lockedAt === row.lockedAt ? [] : [{ ...row, lockedAt }];
  });
  await Promise.all(
    moving.map((row) =>
      db
        .update(schema.domains)
        .set({ lockedAt: row.lockedAt })
        .where(eq(schema.domains.id, row.id)),
    ),
  );
  return { count: rows.length, changed: moving.map((row) => row.hostname) };
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

  // Back inside the cap: whatever they were before the demotion, they are
  // again. A role an admin set by hand since has no previousRole, so a
  // restore never writes over a deliberate change.
  const restored = rows.flatMap((row) =>
    keep.has(row.userId) && row.previousRole !== null
      ? [{ userId: row.userId, role: row.previousRole }]
      : [],
  );
  const demoted = rows.filter((row) => !keep.has(row.userId) && row.role !== "viewer");
  const where = (userId: string) =>
    and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId));
  await Promise.all([
    ...restored.map((row) =>
      db
        .update(schema.orgMembers)
        .set({ role: row.role, previousRole: null })
        .where(where(row.userId)),
    ),
    ...demoted.map((row) =>
      db
        .update(schema.orgMembers)
        .set({ role: "viewer", previousRole: row.role })
        .where(where(row.userId)),
    ),
  ]);
  return { count: rows.length, demoted: demoted.map((row) => row.userId) };
}

async function readEntitlement(db: DB, orgId: string) {
  const rows = await db
    .select()
    .from(schema.orgEntitlements)
    .where(eq(schema.orgEntitlements.orgId, orgId));
  return rows[0] ?? null;
}

/** One org's state after a pass, as the app reads it. */
interface OrgEntitlement {
  over: OverLimits;
  graceEndsAt: number | null;
  /** When the day-0 email for this grace period went out; null while unsent. */
  notifiedAt: number | null;
}

/**
 * Reconciles one org against its owner's plan. Returns the state it wrote.
 */
async function reconcileOrg(
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

  // Three independent resources: neither read nor write of one depends on
  // another, so they go out together.
  const [links, domains, members] = await Promise.all([
    countActiveAddresses(db, org.id),
    reconcileDomainLocks(db, org.id, limits.domains, now),
    reconcileMemberRoles(db, org.id, limits.members),
  ]);

  const over: OverLimits = {};
  if (links > limits.links) over.links = links;
  if (members.count > limits.members) over.members = members.count;
  if (domains.count > limits.domains) over.domains = domains.count;

  const { graceEndsAt, notifiedAt, warnedAt } = graceFor(over, previous, planChanged, now);

  await writeEntitlement(db, {
    orgId: org.id,
    plan,
    overJson: JSON.stringify(over),
    graceEndsAt,
    reconciledAt: now,
    notifiedAt,
    warnedAt,
  });

  // After the row is written, so the KV value the sync reads carries this
  // pass's deadline rather than the one it replaced.
  await enqueueStorage(
    env,
    domains.changed.map((hostname) => syncDomainMsg(hostname)),
  );

  return { over, graceEndsAt, notifiedAt };
}

/**
 * When this org's grace period ends, and which of its two emails have gone
 * out for it.
 *
 * The clock only restarts on a plan change, which is what makes a repeat run
 * a no-op: a second pass on the same plan finds the same stored deadline and
 * writes it back. A new grace period starts unsent, because its two emails
 * describe the new deadline, not the one they were sent about.
 */
function graceFor(
  over: OverLimits,
  previous: {
    graceEndsAt: number | null;
    notifiedAt: number | null;
    warnedAt: number | null;
  } | null,
  planChanged: boolean,
  now: number,
) {
  if (!isOverLimit(over)) return { graceEndsAt: null, notifiedAt: null, warnedAt: null };
  if (planChanged || previous?.graceEndsAt == null)
    return { graceEndsAt: now + GRACE_PERIOD_MS, notifiedAt: null, warnedAt: null };
  return {
    graceEndsAt: previous.graceEndsAt,
    notifiedAt: previous.notifiedAt,
    warnedAt: previous.warnedAt,
  };
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
    // Each org is reconciled against the same plan and touches only its own
    // rows, so they run together.
    await Promise.all(
      orgs.map(async (org) => {
        const state = await reconcileOrg(env, db, org, plan, limits, now);
        await notifyDowngrade(env, db, org, plan, state, now);
      }),
    );
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

  const results = await Promise.all(
    rows.map(async (row) => {
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
      if (!delivered) return false;
      await db
        .update(schema.orgEntitlements)
        .set({ warnedAt: now })
        .where(eq(schema.orgEntitlements.orgId, row.orgId));
      return true;
    }),
  );
  return results.filter(Boolean).length;
}
