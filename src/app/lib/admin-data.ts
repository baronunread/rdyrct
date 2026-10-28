/**
 * The platform-admin queries, with the fields the redesigned screens read
 * before the API sends all of them.
 *
 * Each type below is the shared DTO plus optional fields. The screens use a
 * field when it is there and fall back to what they can derive when it is
 * not, so the Worker can add them one at a time without a client release.
 * The query keys are the ones `hooks.ts` uses, so every invalidation that
 * already targets `["admin", …]` reaches these too.
 */
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  AdminLinkRow,
  AdminOrgRow,
  AdminUsage,
  AdminUserRow,
  SeriesPoint,
} from "@/shared/types";

/** The ranges the usage page offers. */
export type UsageRange = 7 | 30 | 90;

export type AdminUsageData = AdminUsage & {
  /** The range the series cover, when the Worker honours `?days=`. */
  days?: number;
  /** New links per day, same window as `series`. */
  linkSeries?: SeriesPoint[];
  /** People paying, per day, same window as `series`. */
  paidSeries?: SeriesPoint[];
  /** Sign-ups in the range, by the plan each holds today. */
  signupsByPlan?: { free: number; hobby: number; pro: number };
  /** Every org over or near its plan; `capPressure` may be cut short. */
  capPressureTotal?: number;
};

export type AdminUserData = AdminUserRow & {
  /** Links this person made, across every org. */
  links?: number;
  /** Uploaded picture URL, or null for the generated one. */
  image?: string | null;
};

export type AdminOrgData = AdminOrgRow & {
  /** Clicks in the last 30 days, rather than all time. */
  clicks30d?: number;
  /** Over its plan right now (org_entitlements has an over-cap entry). */
  overPlan?: boolean;
  /** When the grace period ends, if it is over its plan. */
  graceEndsAt?: number | null;
  /** Read-only after a downgrade (`orgs.locked_at`). */
  lockedAt?: number | null;
  /** One of its custom domains stopped serving (`domains.locked_at` past grace). */
  domainStoppedAt?: number | null;
};

export function useAdminUsageRange(days: UsageRange) {
  return useQuery(adminUsageQuery(days));
}

export const adminUsageQuery = (days: UsageRange) =>
  queryOptions<AdminUsageData>({
    // The 30-day answer is the one `useAdminUsage` caches, so the key is the
    // same; other ranges get their own.
    queryKey: days === 30 ? ["admin", "usage"] : ["admin", "usage", days],
    queryFn: () => api(days === 30 ? "/admin/usage" : `/admin/usage?days=${days}`),
    placeholderData: keepPreviousData,
  });

export const useAdminUsersData = () => useQuery(adminUsersQuery);

export const adminUsersQuery = queryOptions<AdminUserData[]>({
  queryKey: ["admin", "users"],
  queryFn: () => api("/admin/users"),
});

export const useAdminOrgsData = () => useQuery(adminOrgsQuery);

export const adminOrgsQuery = queryOptions<AdminOrgData[]>({
  queryKey: ["admin", "orgs"],
  queryFn: () => api("/admin/orgs"),
});

/** The link list's filters. `suspended` and `warned` are filtered by the
 * Worker today; `reported` and `flagged` are sent too, and filtered here as
 * well until the Worker reads them. */
export type AdminLinkFilter = "all" | "reported" | "flagged" | "suspended" | "warned";

const FILTER_PARAM = {
  all: "",
  reported: "&reported=1",
  // Worst first, so the 200-row cap holds the flagged ones even before the
  // Worker learns the filter.
  flagged: "&flagged=1&sort=risk",
  suspended: "&suspended=1",
  warned: "&warned=1",
} satisfies Record<AdminLinkFilter, string>;

/** Rows the list endpoint returns at most (MAX_ROWS in admin-links.ts). */
export const ADMIN_LINKS_CAP = 200;

export const useAdminLinksData = (params: AdminLinksParams) => useQuery(adminLinksQuery(params));

export interface AdminLinksParams {
  q: string;
  filter: AdminLinkFilter;
  org?: string;
}

export const adminLinksQuery = (params: AdminLinksParams) =>
  queryOptions<AdminLinkRow[]>({
    queryKey: ["admin", "links", params],
    queryFn: () =>
      api(
        `/admin/links?q=${encodeURIComponent(params.q)}${FILTER_PARAM[params.filter]}` +
          (params.org ? `&org=${encodeURIComponent(params.org)}` : ""),
      ),
    // Without it every pause in typing swapped the table for a skeleton,
    // and unmounted a row menu mid-click.
    placeholderData: keepPreviousData,
  });
