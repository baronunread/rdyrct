// Clicks read the rollups (#26), never raw clicks; both are kept 400 days, so the longest range, 90 days, is always whole.
// Windows are whole UTC days, the same days fillSeries draws, so a total is the sum of its bars.
import { and, desc, eq, gte, isNotNull, isNull, sql, type SQLWrapper } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB } from "./env";
import { computeWindows } from "./rollups";
import { fillSeries } from "./routes/orgs";
import { parseOver } from "./reconcile";
import { avatarUrl } from "./storage";
import { isOverLimit, orgPlanOf, type AdminUsage, type OrgPlan } from "@/shared/types";

const USAGE_RANGES = [7, 30, 90] as const;
type UsageRange = (typeof USAGE_RANGES)[number];

export function usageRange(param: string | undefined): UsageRange {
  return USAGE_RANGES.find((days) => String(days) === param) ?? 30;
}

// Quote user: it is a SQL keyword.
export const ownerPlan = sql<OrgPlan>`coalesce((
  select "user".plan from org_members
  join "user" on "user".id = org_members.user_id
  where org_members.org_id = orgs.id and org_members.role = 'owner'
  limit 1
), 'free')`;

// Leaves out orgs a ban disabled: a spam campaign clicks are not usage. Anomaly checks and each org own row still see them.
export function fromLiveOrg(orgId: SQLWrapper) {
  return sql`${orgId} not in (select id from orgs where disabled_at is not null)`;
}

export const liveUser = eq(schema.user.banned, false);
export const liveOrg = isNull(schema.orgs.disabledAt);

const daily = schema.clickDaily;
const dims = schema.clickDailyDims;
const clickSum = sql<number>`sum(${daily.clicks})`;
const createdDay = sql<string>`date(created_at / 1000, 'unixepoch')`;

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
        .where(and(gte(daily.day, since), fromLiveOrg(daily.orgId)))
        .groupBy(daily.day),
      db
        .select({ day: dims.day, clicks: sql<number>`sum(${dims.clicks})` })
        .from(dims)
        .where(
          and(
            eq(dims.dim, "device"),
            eq(dims.value, "bot"),
            gte(dims.day, since),
            fromLiveOrg(dims.orgId),
          ),
        )
        .groupBy(dims.day),
      db
        .select({ day: createdDay, clicks: sql<number>`count(*)` })
        .from(schema.user)
        .where(and(gte(schema.user.createdAt, new Date(sinceMs)), liveUser))
        .groupBy(createdDay),
      db
        .select({ day: createdDay, clicks: sql<number>`count(*)` })
        .from(schema.links)
        .where(and(gte(schema.links.createdAt, sinceMs), fromLiveOrg(schema.links.orgId)))
        .groupBy(createdDay),
      db
        .select({ plan: schema.user.plan, n: sql<number>`count(*)` })
        .from(schema.user)
        .where(and(gte(schema.user.createdAt, new Date(sinceMs)), liveUser))
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
        .where(and(gte(daily.day, since), fromLiveOrg(daily.orgId)))
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
        .where(and(gte(daily.day, since), fromLiveOrg(daily.orgId)))
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

// Literal orgs.id inside the subqueries: interpolated columns render unqualified there and bind to the wrong table.
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

// A locked domain serves until the org grace ends, or from the moment it was locked when there is no grace (storage.ts servesUntil).
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

export async function linksByCreator(db: DB): Promise<Map<string, number>> {
  const rows = await db
    .select({ userId: schema.links.createdBy, n: sql<number>`count(*)` })
    .from(schema.links)
    .where(isNotNull(schema.links.createdBy))
    .groupBy(schema.links.createdBy);
  return new Map(rows.flatMap((r) => (r.userId ? [[r.userId, r.n] as const] : [])));
}

// user.image holds the owner serving URL, which answers only that account; the admin route serves the same object by id and keeps the version stamp.
export function adminAvatarUrl(userId: string, image: string | null): string | null {
  if (!image?.startsWith(avatarUrl())) return null;
  const version = image.slice(avatarUrl().length);
  return `/api/admin/users/${encodeURIComponent(userId)}/avatar${version}`;
}
