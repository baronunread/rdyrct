import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Env } from "./env";
import type { ClickMessage } from "./clicks";
import { FRESH, type ClickPayload } from "./rollups";
import { billingEnabled, configureBilling, planNow } from "./plan";
import { sendEmail } from "./email";
import { NOTICE_FOOTER, renderEmail } from "./email-layout";
import { PLAN_LIMITS, orgPlanOf, type OrgPlan } from "@/shared/types";
import { effectiveLimits } from "@/shared/limits";
import { loadLimitOverrides, trackedClicksOverrideSql } from "./limit-overrides";
import {
  CLICK_WARN_SHARE,
  exactCount,
  monthKey,
  monthName,
  moreClicksLine,
  nearSentence,
  reachedSentence,
} from "@/shared/click-usage";
import { logFailure } from "./log-failure";

/**
 * Past its plan's monthly cap links keep redirecting but clicks are dropped (#387). The cap
 * check needs no lock because every flush runs inside the one ClickBuffer DO. If the buffer
 * is ever sharded, move it into the statements.
 */

type Allowance = {
  orgId: string;
  month: string;
  plan: string | null;
  userId: string | null;
  used: number;
};

/**
 * Order is kept, so the earliest clicks are the ones counted. Conservative on a
 * redelivered click: it spends allowance though the write skips it. That can only
 * drop a fresh click near the cap, never record one past it.
 */
export async function withinClickCaps(
  env: Env,
  rows: ClickMessage[],
): Promise<{ counted: ClickMessage[]; dropped: ClickMessage[] }> {
  if (rows.length === 0) return { counted: rows, dropped: [] };
  // The flush is not a request. Unset, every org is unlimited.
  configureBilling(env);
  const keys = [...new Set(rows.map((r) => `${r.orgId}|${monthKey(r.ts)}`))];
  const { results } = await env.DB.prepare(
    `with k as (
       select value ->> 0 as org_id, value ->> 1 as month from json_each(?1)
     )
     select k.org_id as orgId, k.month as month, u.plan as plan,
            u.id as userId,
            coalesce(cu.clicks, 0) as used
     from k
     left join org_members m on m.org_id = k.org_id and m.role = 'owner'
     left join user u on u.id = m.user_id
     left join org_click_usage cu on cu.org_id = k.org_id and cu.month = k.month`,
  )
    .bind(JSON.stringify(keys.map((key) => key.split("|"))))
    .all<Allowance>();

  const overrides = await loadLimitOverrides(
    drizzle(env.DB, { schema }),
    results.flatMap((row) => (row.userId ? [row.userId] : [])),
  );
  const room = new Map<string, number>();
  for (const row of results) {
    const limit = effectiveLimits(
      planNow(orgPlanOf(row.plan)),
      row.userId ? overrides.get(row.userId) : undefined,
    ).trackedClicks;
    room.set(`${row.orgId}|${row.month}`, limit - row.used);
  }
  const counted: ClickMessage[] = [];
  const dropped: ClickMessage[] = [];
  // The write stores a duplicate once (FRESH), so a second unit would go unused.
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.dedupeId)) continue;
    seen.add(row.dedupeId);
    const key = `${row.orgId}|${monthKey(row.ts)}`;
    const left = room.get(key) ?? 0;
    if (left <= 0) dropped.push(row);
    else {
      room.set(key, left - 1);
      counted.push(row);
    }
  }
  return { counted, dropped };
}

/** Counts the same fresh clicks as the rollups (FRESH): run before the raw insert, in the same batch. */
export function usageStatement(d1: D1Database, payload: ClickPayload): D1PreparedStatement {
  const month = "strftime('%Y-%m', ts / 1000, 'unixepoch')";
  // WHERE true is SQLite's disambiguation before ON CONFLICT.
  return d1
    .prepare(
      `with ${FRESH}
       insert into org_click_usage (org_id, month, clicks)
       select org_id, ${month}, count(*) from fresh where true
       group by org_id, ${month}
       on conflict (org_id, month) do update set clicks = clicks + excluded.clicks`,
    )
    .bind(payload);
}

export async function clicksThisMonth(env: Env, orgId: string, now = Date.now()) {
  const row = await env.DB.prepare(
    "select clicks from org_click_usage where org_id = ? and month = ?",
  )
    .bind(orgId, monthKey(now))
    .first<{ clicks: number }>();
  return row?.clicks ?? 0;
}

/** One pass emails at most this many orgs at a time: a Workers invocation caps concurrent subrequests. */
const EMAIL_BATCH = 50;
const EMAIL_CONCURRENCY = 5;

type UsageRow = {
  orgId: string;
  name: string;
  email: string;
  plan: string;
  clicks: number;
  lim: number;
  warnedLimit: number | null;
  cappedLimit: number | null;
};

export type ClickEmailKind = "near" | "reached";

/**
 * From the 10-minute cron, not the flush: the flush's subrequest budget is spent and a Resend
 * outage would be retried every ten seconds. Each email is claimed by a conditional update
 * first, so overlapping runs cannot both send. A failed send puts the marker back.
 */
export async function sweepClickUsageEmails(env: Env, now = Date.now()): Promise<number> {
  configureBilling(env);
  if (!billingEnabled()) return 0;
  const { results } = await env.DB.prepare(
    `with usage as (
       select cu.org_id as orgId, o.name as name, u.email as email, u.plan as plan,
              cu.clicks as clicks, cu.warned_limit as warnedLimit, cu.capped_limit as cappedLimit,
              max(
                case u.plan when 'hobby' then ?2 when 'pro' then ?3 else ?4 end,
                -- An account's custom monthly count, when it has one.
                ${trackedClicksOverrideSql("u")}
              ) as lim
       from org_click_usage cu
       join orgs o on o.id = cu.org_id and o.deleting_at is null
       join org_members m on m.org_id = cu.org_id and m.role = 'owner'
       join user u on u.id = m.user_id
       where cu.month = ?1 and cu.clicks >= ?5
     )
     select * from usage
     where (clicks >= lim and cappedLimit is not lim)
        or (clicks >= lim * ?6 and warnedLimit is not lim and cappedLimit is not lim)
     limit ?7`,
  )
    .bind(
      monthKey(now),
      PLAN_LIMITS.hobby.trackedClicks,
      PLAN_LIMITS.pro.trackedClicks,
      PLAN_LIMITS.free.trackedClicks,
      Math.floor(PLAN_LIMITS.free.trackedClicks * CLICK_WARN_SHARE),
      CLICK_WARN_SHARE,
      EMAIL_BATCH,
    )
    .all<UsageRow>();

  let sent = 0;
  for (let i = 0; i < results.length; i += EMAIL_CONCURRENCY) {
    const outcomes = await Promise.all(
      results.slice(i, i + EMAIL_CONCURRENCY).map((row) => emailOne(env, row, now)),
    );
    sent += outcomes.filter(Boolean).length;
  }
  return sent;
}

async function emailOne(env: Env, row: UsageRow, now: number): Promise<boolean> {
  const kind: ClickEmailKind = row.clicks >= row.lim ? "reached" : "near";
  const month = monthKey(now);
  // Reaching the cap sets both markers: the 80% email would no longer be true.
  const claim =
    kind === "reached"
      ? env.DB.prepare(
          `update org_click_usage set capped_limit = ?1, warned_limit = ?1
           where org_id = ?2 and month = ?3 and capped_limit is not ?1`,
        )
      : env.DB.prepare(
          `update org_click_usage set warned_limit = ?1
           where org_id = ?2 and month = ?3 and warned_limit is not ?1 and capped_limit is not ?1`,
        );
  try {
    const claimed = await claim.bind(row.lim, row.orgId, month).run();
    if (claimed.meta.changes === 0) return false;
  } catch {
    return false;
  }
  try {
    const { subject, body } = clickUsageEmail(
      kind,
      { name: row.name, plan: orgPlanOf(row.plan), clicks: row.clicks, limit: row.lim, now },
      env.APP_URL,
      row.email,
    );
    await sendEmail(env, row.email, subject, body);
    return true;
  } catch (error) {
    logFailure("click_usage_email_failed", error, { kind });
    await env.DB.prepare(
      `update org_click_usage set warned_limit = ?1, capped_limit = ?2
       where org_id = ?3 and month = ?4`,
    )
      .bind(row.warnedLimit, row.cappedLimit, row.orgId, month)
      .run()
      .catch(() => undefined);
    return false;
  }
}

export function clickUsageEmail(
  kind: ClickEmailKind,
  org: { name: string; plan: OrgPlan; clicks: number; limit: number; now: number },
  appUrl: string,
  to: string,
) {
  const limit = exactCount(org.limit);
  const month = monthName(org.now);
  const more = moreClicksLine(org.plan);
  const subject =
    kind === "reached"
      ? // The cap, not the count: a downgrade can leave the count far past it.
        `${org.name} has reached its plan's ${limit} tracked clicks for ${month}`
      : `${org.name} has used ${Math.round(CLICK_WARN_SHARE * 100)}% of its tracked clicks for ${month}`;
  const preheader =
    kind === "reached" ? reachedSentence(org.limit, org.now) : nearSentence(org.limit, org.now);
  const paragraphs =
    kind === "reached"
      ? [preheader, ...(more ? [`${more} Upgrade to count them.`] : [])]
      : [
          `${org.name} has recorded ${exactCount(org.clicks)} of the ${limit} clicks its plan counts this month.`,
          preheader,
          ...(more ? [`${more} Upgrade if you expect more.`] : []),
        ];
  const body = renderEmail(
    {
      preheader,
      heading: subject,
      paragraphs,
      cta: { label: "See your plan", url: `${appUrl}/billing` },
      footerLine: NOTICE_FOOTER,
    },
    appUrl,
    to,
  );
  return { subject, body };
}
