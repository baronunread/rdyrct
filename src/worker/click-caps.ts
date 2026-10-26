import type { Env } from "./env";
import type { ClickMessage } from "./clicks";
import { FRESH, type ClickPayload } from "./rollups";
import { billingEnabled, configureBilling, planNow } from "./plan";
import { sendEmail } from "./email";
import { NOTICE_FOOTER, renderEmail } from "./email-layout";
import { PLAN_LIMITS, orgPlanOf, type OrgPlan } from "@/shared/types";
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
 * Tracked clicks per plan (#387).
 *
 * Every org records up to its plan's `trackedClicks` a UTC month. Past that,
 * its links keep redirecting (the redirect path never reads any of this) and
 * the clicks are dropped before they are written: no raw row, no rollup.
 *
 * The count lives in `org_click_usage`, one row per org per month, added to in
 * the same batch as the raw rows and the rollups (usageStatement below), so it
 * is exactly the number of clicks stored.
 *
 * Why the check needs no lock: it is a read (withinClickCaps) followed by a
 * write (the flush's batch), and nothing else writes the counter. Every flush
 * runs inside the one ClickBuffer Durable Object, whose `#flushing` flag lets
 * a single flush run at a time even when an alarm and a full buffer both ask
 * for one (click-buffer.ts). So no second flush can spend the same allowance
 * between the read and the write. If the buffer is ever sharded, this has to
 * move into the statements themselves.
 */

/* ---------------- the cap, at flush time ---------------- */

type Allowance = { orgId: string; month: string; plan: string | null; used: number };

/**
 * Split a flush into the clicks that still fit their org's cap for their
 * month (`counted`) and the ones past it (`dropped`, which the abuse sweep
 * still counts: see click-overflow.ts). Order is kept, so the earliest clicks
 * of a flush are the ones counted.
 *
 * One query for every org and month in the flush: the owner's plan (comps
 * included, since `user.plan` is already the comp or the subscription) and
 * the month's count so far.
 *
 * Conservative on a redelivered click: it spends allowance here although the
 * write will skip it as already stored. That can only drop a fresh click that
 * would have fit, near the cap, in a flush that is redelivering, never record
 * one past the cap. Checking `clicks` for every id here would cost a read per
 * click on every flush to save a few clicks at the cap in a rare one.
 */
export async function withinClickCaps(
  env: Env,
  rows: ClickMessage[],
): Promise<{ counted: ClickMessage[]; dropped: ClickMessage[] }> {
  if (rows.length === 0) return { counted: rows, dropped: [] };
  // The buffer's flush is not a request, so nothing else has said whether
  // this deployment sells plans. Unset, every org is unlimited.
  configureBilling(env);
  const keys = [...new Set(rows.map((r) => `${r.orgId}|${monthKey(r.ts)}`))];
  const { results } = await env.DB.prepare(
    `with k as (
       select value ->> 0 as org_id, value ->> 1 as month from json_each(?1)
     )
     select k.org_id as orgId, k.month as month, u.plan as plan,
            coalesce(cu.clicks, 0) as used
     from k
     left join org_members m on m.org_id = k.org_id and m.role = 'owner'
     left join user u on u.id = m.user_id
     left join org_click_usage cu on cu.org_id = k.org_id and cu.month = k.month`,
  )
    .bind(JSON.stringify(keys.map((key) => key.split("|"))))
    .all<Allowance>();

  const room = new Map<string, number>();
  for (const row of results) {
    const limit = PLAN_LIMITS[planNow(orgPlanOf(row.plan))].trackedClicks;
    room.set(`${row.orgId}|${row.month}`, limit - row.used);
  }
  const counted: ClickMessage[] = [];
  const dropped: ClickMessage[] = [];
  // The same click twice in one flush spends one unit: the write stores it
  // once (FRESH), so a second unit would be allowance nothing uses.
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

/**
 * Add a chunk's stored clicks to the monthly counter. Counts the same fresh
 * clicks the rollups do (see FRESH), so it must run before the chunk's raw
 * insert, in the same batch.
 */
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

/* ---------------- what the app reads ---------------- */

/** An org's count for the month `now` falls in. */
export async function clicksThisMonth(env: Env, orgId: string, now = Date.now()) {
  const row = await env.DB.prepare(
    "select clicks from org_click_usage where org_id = ? and month = ?",
  )
    .bind(orgId, monthKey(now))
    .first<{ clicks: number }>();
  return row?.clicks ?? 0;
}

/* ---------------- the 80% and 100% emails ---------------- */

/** One pass emails at most this many orgs, this many at a time, as the grace
 * sweep does: a Workers invocation caps concurrent subrequests. */
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
 * Send the 80% and 100% emails that are due this month (#387).
 *
 * From the 10-minute cron, not from the flush. The flush runs every ten
 * seconds inside the click buffer, whose subrequest budget is already spoken
 * for by the D1 fallback; a send there would compete with recording clicks,
 * and a Resend outage would be retried every ten seconds. Here a send is
 * tried at most every ten minutes, and the email is at most ten minutes late.
 *
 * Each email is claimed before it is sent: the marker is set in a conditional
 * update first, and only the run whose update wrote it sends. So two
 * overlapping runs (the 10-minute and the daily trigger) cannot both send,
 * and a marker write that fails cannot turn into an email every ten minutes.
 * A send that fails puts the marker back, so the next run tries again.
 */
export async function sweepClickUsageEmails(env: Env, now = Date.now()): Promise<number> {
  configureBilling(env);
  // No billing, no caps: every org is unlimited, so there is nothing to say.
  if (!billingEnabled()) return 0;
  const { results } = await env.DB.prepare(
    `with usage as (
       select cu.org_id as orgId, o.name as name, u.email as email, u.plan as plan,
              cu.clicks as clicks, cu.warned_limit as warnedLimit, cu.capped_limit as cappedLimit,
              case u.plan when 'hobby' then ?2 when 'pro' then ?3 else ?4 end as lim
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
      // Nothing under 80% of the smallest cap can be due, which keeps the
      // read to the busy end of the (month, clicks) index.
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
  // The 100% email sets both markers: an org that went from under 80% to
  // its cap between two runs gets the one email that is still true.
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
    // Put the markers back as they were, so the next run tries again.
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

/** The 80% and 100% emails. Pure, so the copy is tested without a send. */
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
  // What still works comes first in the inbox preview: the reader's first
  // worry is the links, not the numbers.
  const preheader =
    kind === "reached" ? reachedSentence(org.limit, org.now) : nearSentence(org.limit, org.now);
  const paragraphs =
    kind === "reached"
      ? // The heading already says what happened. A plan with nothing above
        // it (Pro) gets no extra line: the footer already says where to write.
        [preheader, ...(more ? [`${more} Upgrade to count them.`] : [])]
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
