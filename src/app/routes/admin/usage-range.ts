/**
 * The usage page's range, kept in the URL (`/admin?range=7d`). The control
 * sits in the admin header and the page reads it, so the URL is what joins
 * the two, and a link to "the last 90 days" stays one.
 */
import type { UsageRange } from "../../lib/admin-data";
import { useSearchParams } from "../../lib/router-search";

const IDS = ["7d", "30d", "90d"] as const;
type RangeId = (typeof IDS)[number];

export const RANGE_ITEMS = IDS.map((id) => ({ id, label: id }));

const DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const satisfies Record<RangeId, UsageRange>;

/** The range id in the URL, 30d when there is none or it is not one of ours. */
export function useUsageRange(): [RangeId, (next: RangeId) => void] {
  const [params, setParams] = useSearchParams();
  const range = rangeFrom(params);
  const set = (next: RangeId) => {
    if (next === "30d") params.delete("range");
    else params.set("range", next);
    setParams(params, { replace: true });
  };
  return [range, set];
}

export const rangeDays = (id: RangeId): UsageRange => DAYS[id];

function rangeFrom(params: URLSearchParams): RangeId {
  const raw = params.get("range");
  return IDS.find((id) => id === raw) ?? "30d";
}

/** The days a query string asks for, for a preload that has no hook. */
export const usageDaysFrom = (searchStr: string): UsageRange =>
  rangeDays(rangeFrom(new URLSearchParams(searchStr)));
