import type { UsageRange } from "../../lib/admin-data";
import { useSearchParams } from "../../lib/router-search";

const IDS = ["7d", "30d", "90d"] as const;
type RangeId = (typeof IDS)[number];

export const RANGE_ITEMS = IDS.map((id) => ({ id, label: id }));

const DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const satisfies Record<RangeId, UsageRange>;

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

export const usageDaysFrom = (searchStr: string): UsageRange =>
  rangeDays(rangeFrom(new URLSearchParams(searchStr)));
