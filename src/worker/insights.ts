import type { OrgInsight, OrgInsights, StatsLinkRef } from "../shared/types";
import { computeWindows } from "./rollups";
import type { Env } from "./env";

// Floors keep small numbers out: Up 100% from 1 click to 2 is noise.
const INSIGHT_FLOORS = {
  countryClicks: 20,
  countryPct: 25,
  countryDelta: 10,
  linkPrevious: 20,
  linkFallPct: 50,
  referrerClicks: 10,
  minorDelta: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const FAR_FUTURE = "9999-12-31";

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The 24-hour view compares the last two whole UTC days: rollups are daily and today is partial.
function insightWindow(days: number, now = Date.now()) {
  if (days <= 1) {
    const today = now - (now % DAY_MS);
    return {
      days: 1,
      from: dayKey(today - DAY_MS),
      to: dayKey(today),
      prevFrom: dayKey(today - 2 * DAY_MS),
    };
  }
  const w = computeWindows(days, now);
  return { days, from: w.since, to: FAR_FUTURE, prevFrom: w.prevSince };
}

type Window = ReturnType<typeof insightWindow>;

const pctChange = (current: number, previous: number) =>
  Math.round(((current - previous) / previous) * 100);

type CountryRow = { country: string; cur: number; prev: number };

async function countryMovers(env: Env, orgId: string, w: Window) {
  const { results } = await env.DB.prepare(
    `select value as country,
            coalesce(sum(case when day >= ?1 and day < ?2 then clicks end), 0) as cur,
            coalesce(sum(case when day >= ?3 and day < ?1 then clicks end), 0) as prev
     from click_daily_dims
     where org_id = ?4 and dim = 'country' and day >= ?3 and day < ?2
       and value not in ('', 'XX', 'unknown')
     group by value`,
  )
    .bind(w.from, w.to, w.prevFrom, orgId)
    .all<CountryRow>();
  return results;
}

async function fallenLink(env: Env, orgId: string, w: Window) {
  const { results } = await env.DB.prepare(
    `with t as (
       select link_id,
              coalesce(sum(case when day >= ?1 and day < ?2 then clicks end), 0) as cur,
              coalesce(sum(case when day >= ?3 and day < ?1 then clicks end), 0) as prev
       from click_daily where org_id = ?4 and day >= ?3 and day < ?2 group by link_id
     )
     select l.id, l.slug, l.title, dm.hostname as domain, t.cur, t.prev
     from t join links l on l.id = t.link_id left join domains dm on dm.id = l.domain_id
     where t.prev >= ?5 and t.cur * 100 <= t.prev * (100 - ?6)
     order by t.prev - t.cur desc limit 1`,
  )
    .bind(w.from, w.to, w.prevFrom, orgId, INSIGHT_FLOORS.linkPrevious, INSIGHT_FLOORS.linkFallPct)
    .all<StatsLinkRef & { cur: number; prev: number }>();
  return results[0] ?? null;
}

async function newReferrer(env: Env, orgId: string, w: Window) {
  const { results } = await env.DB.prepare(
    `select l.id, l.slug, l.title, dm.hostname as domain, d.value as referrer,
            d.clicks, d.since
     from (
       select link_id, value, sum(clicks) as clicks, min(day) as since
       from click_daily_dims
       where org_id = ?3 and dim = 'referrer' and value <> '' and day < ?2
       group by link_id, value
       having sum(case when day < ?1 then clicks end) is null
          and sum(case when day >= ?1 then clicks end) >= ?4
     ) d
     join links l on l.id = d.link_id left join domains dm on dm.id = l.domain_id
     where exists (select 1 from click_daily c where c.link_id = d.link_id and c.day < ?1)
     order by d.clicks desc limit 1`,
  )
    .bind(w.from, w.to, orgId, INSIGHT_FLOORS.referrerClicks)
    .all<StatsLinkRef & { referrer: string; clicks: number; since: string }>();
  return results[0] ?? null;
}

function countryInsight(c: CountryRow): OrgInsight {
  return {
    kind: "country",
    country: c.country,
    current: c.cur,
    previous: c.prev,
    // A country with no clicks before has no percent: 100 is the cap, and only the volume floor lets one through.
    pct: c.prev > 0 ? pctChange(c.cur, c.prev) : 100,
  };
}

const bySize = (a: CountryRow, b: CountryRow) =>
  Math.abs(b.cur - b.prev) - Math.abs(a.cur - a.prev);

export async function orgInsights(
  env: Env,
  orgId: string,
  requestedDays: number,
): Promise<OrgInsights> {
  const w = insightWindow(requestedDays);
  const [countries, fell, referrer] = await Promise.all([
    countryMovers(env, orgId, w),
    fallenLink(env, orgId, w),
    newReferrer(env, orgId, w),
  ]);
  const f = INSIGHT_FLOORS;
  const sorted = [...countries].sort(bySize);
  const big = sorted.find(
    (c) =>
      Math.max(c.cur, c.prev) >= f.countryClicks &&
      Math.abs(c.cur - c.prev) >= f.countryDelta &&
      (c.prev === 0 || Math.abs(pctChange(c.cur, c.prev)) >= f.countryPct),
  );
  const insights: OrgInsight[] = [];
  if (big) insights.push(countryInsight(big));
  if (fell) {
    const { cur, prev, ...link } = fell;
    insights.push({
      kind: "link_fell",
      link,
      current: cur,
      previous: prev,
      pct: Math.round(((prev - cur) * 100) / prev),
    });
  }
  if (referrer) {
    const { referrer: host, clicks, since, ...link } = referrer;
    insights.push({ kind: "first_referrer", link, referrer: host, clicks, since });
  }
  const top = sorted[0];
  const minor =
    insights.length === 0 && top && Math.abs(top.cur - top.prev) >= f.minorDelta
      ? countryInsight(top)
      : null;
  return { days: w.days, insights, minor };
}
