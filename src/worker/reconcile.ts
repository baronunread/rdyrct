import * as v from "valibot";
import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
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
  orgs: { id: string; name: string; lockedAt: number | null }[],
  limit: number,
  now: number,
): Promise<{ id: string; name: string }[]> {
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
  // Only the ones newly locked. An unlock is good news nobody needs an email
  // about, and a repeat pass moves nothing, so it sends nothing.
  return lockedAt === null ? [] : moving.map((org) => ({ id: org.id, name: org.name }));
}

/**
 * Locks the domains beyond the org's cap, oldest kept (#159).
 *
 * Returns the hostnames whose lock moved, and every hostname that is locked
 * now. The caller needs both: the KV value carries the *deadline* as well as
 * the lock, so a domain whose lock did not move still needs a republish when
 * the org's grace period restarts under it.
 */
async function reconcileDomainLocks(
  db: DB,
  orgId: string,
  limit: number,
  now: number,
): Promise<{ count: number; changed: string[]; locked: string[] }> {
  const rows = await db
    .select({
      id: schema.domains.id,
      hostname: schema.domains.hostname,
      lockedAt: schema.domains.lockedAt,
      status: schema.domains.status,
    })
    .from(schema.domains)
    .where(eq(schema.domains.orgId, orgId))
    // Serving domains first, then oldest. "Oldest keeps working" only holds
    // if the oldest actually works: an org whose first domain never finished
    // DNS would otherwise keep that one and lock the one carrying its links.
    .orderBy(
      sql`case when ${schema.domains.status} = 'active' then 0 else 1 end`,
      asc(schema.domains.createdAt),
      asc(schema.domains.id),
    );

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
  return {
    count: rows.length,
    changed: moving.map((row) => row.hostname),
    locked: rows.flatMap((row, index) => (index < limit ? [] : [row.hostname])),
  };
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

  // Every locked domain when the deadline moved, only the ones whose lock
  // moved otherwise. `servesUntil` in KV is built from the org's
  // `graceEndsAt` (see desiredKvValue), so a restarted grace that republished
  // nothing left already-locked hosts carrying the *old* deadline: pro to
  // hobby, thirty days, then hobby to free, and two domains 404 through a
  // grace period D1 says is still running.
  //
  // After the row is written, so the KV value the sync reads carries this
  // pass's deadline rather than the one it replaced.
  const republish =
    graceEndsAt === (previous?.graceEndsAt ?? null)
      ? domains.changed
      : [...new Set([...domains.changed, ...domains.locked])];
  await enqueueStorage(
    env,
    republish.map((hostname) => syncDomainMsg(hostname)),
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
    const newlyLocked = await reconcileOrgLocks(db, orgs, limits.orgs, now);
    // Each org is reconciled against the same plan and touches only its own
    // rows, so they run together.
    await Promise.all(
      orgs.map(async (org) => {
        const state = await reconcileOrg(env, db, org, plan, limits, now);
        await notifyDowngrade(env, db, org, plan, state, now);
      }),
    );
    // Being over the *owned-org* cap is a fact about the user, not about any
    // one org, so it has no `over` entry and no per-org email would ever
    // mention it (#160). Without this an owner whose only breach is the org
    // cap heard nothing at all: two of their orgs went read-only and the
    // first they knew of it was opening the app.
    await notifyOrgsLocked(env, db, userId, plan, newlyLocked);
  } catch (error) {
    captureAlert([{ event: "reconcile_failed", userId }]);
    console.error("reconcile_failed", userId, error);
  }
}

/** Tells an owner which orgs went read-only, and that they may pick a
 * different one. Best-effort: a failed send must not turn a reconciliation
 * whose D1 writes all landed into a `reconcile_failed` alert. */
async function notifyOrgsLocked(
  env: Env,
  db: DB,
  userId: string,
  plan: OrgPlan,
  locked: { id: string; name: string }[],
): Promise<void> {
  if (!locked.length) return;
  const rows = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const to = rows[0]?.email;
  if (!to) return;
  const limit = PLAN_LIMITS[plan].orgs;
  const names = locked.map((org) => org.name).join(", ");
  const heading =
    locked.length === 1 ? `${names} is read-only` : `Some organizations are read-only`;
  const body = renderEmail({
    preheader: `Your plan covers ${limit === 1 ? "one organization" : `${limit} organizations`}.`,
    heading,
    paragraphs: [
      `Your plan covers ${limit === 1 ? "one organization" : `${limit} organizations`}, and you own more, so ${names} ${locked.length === 1 ? "is" : "are"} now read-only.`,
      "Nothing was deleted, and every link in them keeps redirecting.",
      "Upgrade to unlock all of them, or open one and choose to keep it active instead.",
    ],
    cta: { label: "See your plan", url: `${env.APP_URL}/billing` },
  });
  await sendEmail(env, to, heading, body).catch(() => {});
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
  // Named for what is actually over. "loses its custom domains soon" went to
  // every org with a grace period, including ones whose only breach was links
  // or members and which lose nothing at all when the deadline passes.
  const heading =
    kind === "warning" && state.over.domains !== undefined
      ? `${org.name} loses its custom domains soon`
      : `${org.name} is over its plan`;
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
  // Best-effort, and unmarked on failure: the daily sweep retries it, and a
  // dead Resend must not make a pass whose D1 writes all landed report
  // `reconcile_failed`.
  const sent = await sendDowngradeEmail(env, db, org, plan, state, "now").catch(() => false);
  if (!sent) return;
  await db
    .update(schema.orgEntitlements)
    .set({ notifiedAt: now })
    .where(eq(schema.orgEntitlements.orgId, org.id));
}

/**
 * The grace-period emails the daily cron owns: the day-23 warning, and any
 * day-0 notice whose send failed at reconciliation time.
 *
 * Reconciliation only runs on a plan change, so without the second of those a
 * transient Resend outage meant the owner heard nothing for 23 days. A send
 * failure leaves the marker null, so tomorrow's run tries again, and the
 * warning window is a week wide rather than a single day for the same reason.
 */
/**
 * One pass emails at most this many orgs, in chunks this wide.
 *
 * A Workers invocation has a cap on concurrent subrequests, so a downgrade
 * wave that started every send at once would fail the whole sweep. The
 * warning window is a week wide, so a backlog drains over the following days
 * instead of in one invocation.
 */
const EMAIL_BATCH = 50;
const EMAIL_CONCURRENCY = 5;

export async function sweepGraceWarnings(env: Env, db: DB, now = Date.now()): Promise<number> {
  const rows = await db
    .select({
      orgId: schema.orgEntitlements.orgId,
      name: schema.orgs.name,
      plan: schema.orgEntitlements.plan,
      overJson: schema.orgEntitlements.overJson,
      graceEndsAt: schema.orgEntitlements.graceEndsAt,
      notifiedAt: schema.orgEntitlements.notifiedAt,
      warnedAt: schema.orgEntitlements.warnedAt,
    })
    .from(schema.orgEntitlements)
    .innerJoin(schema.orgs, eq(schema.orgEntitlements.orgId, schema.orgs.id))
    .where(
      and(
        isNotNull(schema.orgEntitlements.graceEndsAt),
        sql`${schema.orgEntitlements.graceEndsAt} > ${now}`,
        or(
          // A day-0 send that failed at reconciliation time. Reconciliation
          // only runs on a plan change, so nothing else would retry it.
          isNull(schema.orgEntitlements.notifiedAt),
          and(
            isNull(schema.orgEntitlements.warnedAt),
            lte(schema.orgEntitlements.graceEndsAt, now + GRACE_WARNING_MS),
          ),
        ),
      ),
    )
    .limit(EMAIL_BATCH);

  let sent = 0;
  for (let i = 0; i < rows.length; i += EMAIL_CONCURRENCY) {
    const results = await Promise.all(
      rows.slice(i, i + EMAIL_CONCURRENCY).map((row) => sweepOne(env, db, row, now)),
    );
    sent += results.filter(Boolean).length;
  }
  return sent;
}

/**
 * Sends one org's outstanding email and marks it.
 *
 * Every failure is caught here, the marker included: a row whose update threw
 * would otherwise take the rest of its chunk down with it, and rows already
 * emailed in this pass would lose their marker and be emailed again tomorrow.
 */
async function sweepOne(
  env: Env,
  db: DB,
  row: {
    orgId: string;
    name: string;
    plan: string;
    overJson: string;
    graceEndsAt: number | null;
    notifiedAt: number | null;
  },
  now: number,
): Promise<boolean> {
  const kind = row.notifiedAt === null ? "now" : "warning";
  try {
    const state = {
      over: parseOver(row.overJson),
      graceEndsAt: row.graceEndsAt,
      notifiedAt: row.notifiedAt,
    };
    const org = { id: row.orgId, name: row.name };
    if (!(await sendDowngradeEmail(env, db, org, orgPlanOf(row.plan), state, kind))) return false;
    await db
      .update(schema.orgEntitlements)
      .set(kind === "now" ? { notifiedAt: now } : { warnedAt: now })
      .where(eq(schema.orgEntitlements.orgId, row.orgId));
    return true;
  } catch {
    // Left unmarked on purpose, so tomorrow's run tries again.
    return false;
  }
}
