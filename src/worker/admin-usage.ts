/**
 * The platform-admin figures that follow the range the Usage page picks, and
 * the per-row extras the Organizations and Users lists carry.
 *
 * Clicks read the rollups (#26), never raw `clicks`: a range costs the
 * link-days in it rather than the clicks, and both are kept 400 days
 * (rollups.ts, ROLLUP_RETENTION_DAYS, and the raw sweep in scheduled()), so
 * the longest range here, 90 days, is always whole.
 *
 * Windows are whole UTC days, the same days fillSeries draws, so a total is
 * always the sum of its bars.
 */
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB } from "./env";
import { computeWindows } from "./rollups";
import { fillSeries } from "./routes/orgs";
import { parseOver } from "./reconcile";
import { avatarUrl } from "./storage";
import { isOverLimit, orgPlanOf, type AdminUsage, type OrgPlan } from "@/shared/types";

/** The ranges the Usage page offers; anything else reads as 30. */
const USAGE_RANGES = [7, 30, 90] as const;
type UsageRange = (typeof USAGE_RANGES)[number];

export function usageRange(param: string | undefined): UsageRange {
  return USAGE_RANGES.find((days) => String(days) === param) ?? 30;
}

// An org's effective plan is its owner's plan (billing is per-user). A single
// correlated subquery pulls it for list views. Note: `user` is a SQL keyword,
// so it must stay quoted here.
export const ownerPlan = sql<OrgPlan>`coalesce((
  select "user".plan from org_members
  join "user" on "user".id = org_members.user_id
  where org_members.org_id = orgs.id and org_members.role = 'owner'
  limit 1
), 'free')`;

const daily = schema.clickDaily;
const dims = schema.clickDailyDims;
const clickSum = sql<number>`sum(${daily.clicks})`;
// Unqualified: each query using it reads one table.
const createdDay = sql<string>`date(created_at / 1000, 'unixepoch')`;

/** The fields of the usage answer that follow `days`. */
type RangeFigures = Pick<
  AdminUsage,
  | "days"
  | "series"
  | "signups"
  | "botSeries"
  | "topOrgs"
  | "topLinks"
  | "linkSeries"
  | "signupsByPlan"
>;

export async function usageForRange(db: DB, days: UsageRange): Promise<RangeFigures> {
  const { since, sinceMs } = computeWindows(days);
  const [clickRows, botRows, signupRows, linkRows, signupPlanRows, topOrgs, topLinks] =
    await Promise.all([
      db
        .select({ day: daily.day, clicks: clickSum })
        .from(daily)
        .where(gte(daily.day, since))
        .groupBy(daily.day),
      db
        .select({ day: dims.day, clicks: sql<number>`sum(${dims.clicks})` })
        .from(dims)
        .where(and(eq(dims.dim, "device"), eq(dims.value, "bot"), gte(dims.day, since)))
        .groupBy(dims.day),
      db
        .select({ day: createdDay, clicks: sql<number>`count(*)` })
        .from(schema.user)
        .where(gte(schema.user.createdAt, new Date(sinceMs)))
        .groupBy(createdDay),
      db
        .select({ day: createdDay, clicks: sql<number>`count(*)` })
        .from(schema.links)
        .where(gte(schema.links.createdAt, sinceMs))
        .groupBy(createdDay),
      db
        .select({ plan: schema.user.plan, n: sql<number>`count(*)` })
        .from(schema.user)
        .where(gte(schema.user.createdAt, new Date(sinceMs)))
        .groupBy(schema.user.plan),
      db
        .select({
          id: schema.orgs.id,
          name: schema.orgs.name,
          clicks: clickSum,
          plan: ownerPlan,
        })
        .from(daily)
        .innerJoin(schema.orgs, eq(daily.orgId, schema.orgs.id))
        .where(gte(daily.day, since))
        .groupBy(daily.orgId)
        .orderBy(desc(clickSum))
        .limit(5),
      db
        .select({
          id: schema.links.id,
          slug: schema.links.slug,
          domain: schema.domains.hostname,
          orgName: schema.orgs.name,
          clicks: clickSum,
        })
        .from(daily)
        .innerJoin(schema.links, eq(daily.linkId, schema.links.id))
        .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
        .innerJoin(schema.orgs, eq(schema.links.orgId, schema.orgs.id))
        .where(gte(daily.day, since))
        .groupBy(daily.linkId)
        .orderBy(desc(clickSum))
        .limit(5),
    ]);
  const signupsByPlan = { free: 0, hobby: 0, pro: 0 };
  for (const row of signupPlanRows) signupsByPlan[orgPlanOf(row.plan)] += row.n;
  return {
    days,
    series: fillSeries(clickRows, days),
    signups: fillSeries(signupRows, days),
    botSeries: fillSeries(botRows, days),
    linkSeries: fillSeries(linkRows, days),
    signupsByPlan,
    topOrgs: topOrgs.map((o) => ({ ...o, plan: orgPlanOf(o.plan) })),
    topLinks,
  };
}

/* ─────────── organizations list ─────────── */

/** The columns the org list adds for an org's plan state. Literal `orgs.id`
 * inside the subqueries: interpolated columns render unqualified there and
 * bind to the wrong table. */
export function orgPlanStateColumns(since30: string) {
  return {
    clicks: sql<number>`(
      select coalesce(sum(clicks), 0) from click_daily where click_daily.org_id = orgs.id
    )`,
    clicks30d: sql<number>`(
      select coalesce(sum(clicks), 0) from click_daily
      where click_daily.org_id = orgs.id and click_daily.day >= ${since30}
    )`,
    lockedAt: schema.orgs.lockedAt,
    overJson: schema.orgEntitlements.overJson,
    entitlementGraceEndsAt: schema.orgEntitlements.graceEndsAt,
    firstDomainLock: sql<number | null>`(
      select min(locked_at) from domains where domains.org_id = orgs.id
    )`,
  };
}

/**
 * Over plan, when the grace ends, and when a locked domain stopped serving.
 *
 * A locked domain serves until the org's grace ends, or from the moment it
 * was locked when there is no grace (storage.ts, `servesUntil`), so that is
 * the moment it stopped, once it has passed.
 */
export function orgPlanState(
  row: {
    overJson: string | null;
    entitlementGraceEndsAt: number | null;
    firstDomainLock: number | null;
  },
  now = Date.now(),
) {
  const overPlan = row.overJson !== null && isOverLimit(parseOver(row.overJson));
  const graceEndsAt = overPlan ? row.entitlementGraceEndsAt : null;
  const stops =
    row.firstDomainLock === null ? null : (row.entitlementGraceEndsAt ?? row.firstDomainLock);
  return { overPlan, graceEndsAt, domainStoppedAt: stops !== null && stops <= now ? stops : null };
}

/* ─────────── users list ─────────── */

/** Links each person made, across every org, in one pass over `links`
 * rather than a count per user. */
export async function linksByCreator(db: DB): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: schema.links.createdBy, n: sql<number>`count(*)` })
    .from(schema.links)
    .where(isNotNull(schema.links.createdBy))
    .groupBy(schema.links.createdBy);
  return new Map(rows.flatMap((r) => (r.userId ? [[r.userId, r.n] as const] : [])));
}

/** Where an admin's browser fetches somebody's picture, or null for the
 * generated one. `user.image` holds the owner's own serving URL
 * (`/api/user/avatar?v=…`), which answers only that account; the admin
 * route serves the same object by id, and keeps the version stamp so a new
 * upload is a new URL here too. */
export function adminAvatarUrl(userId: string, image: string | null): string | null {
  if (!image?.startsWith(avatarUrl())) return null;
  const version = image.slice(avatarUrl().length);
  return `/api/admin/users/${encodeURIComponent(userId)}/avatar${version}`;
}
