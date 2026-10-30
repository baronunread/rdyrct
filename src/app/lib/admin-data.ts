/**
 * The platform-admin queries the redesigned screens read.
 *
 * `AdminUsageData` is the shared DTO plus the two fields the Worker does not
 * send yet: the screens use each when it is there and say so when it is not.
 * The query keys are the ones `hooks.ts` uses, so every invalidation that
 * already targets `["admin", …]` reaches these too.
 */
import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type {
  AdminLinkCounts,
  AdminLinkRow,
  AdminOrgRow,
  AdminUsage,
  AdminUserRow,
  SeriesPoint,
} from "@/shared/types";

/** The ranges the usage page offers. */
export type UsageRange = 7 | 30 | 90;

export type AdminUsageData = AdminUsage & {
  /** People paying, per day, same window as `series`. Nothing records a
   * plan's history before the `plan.change` audit entries, so the Worker
   * cannot draw this yet. */
  paidSeries?: SeriesPoint[];
  /** Every org over or near its plan; `capPressure` may be cut short. */
  capPressureTotal?: number;
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

export const adminUsersQuery = queryOptions<AdminUserRow[]>({
  queryKey: ["admin", "users"],
  queryFn: () => api("/admin/users"),
});

export const useAdminOrgsData = () => useQuery(adminOrgsQuery);

export const adminOrgsQuery = queryOptions<AdminOrgRow[]>({
  queryKey: ["admin", "orgs"],
  queryFn: () => api("/admin/orgs"),
});

/** The link list's filters, each one a parameter the Worker reads. */
export type AdminLinkFilter = "all" | "reported" | "flagged" | "suspended" | "warned";

const FILTER_PARAM = {
  all: "",
  reported: "&reported=1",
  // Worst first, so the 200-row cap holds the worst of them.
  flagged: "&flagged=1&sort=risk",
  suspended: "&suspended=1",
  warned: "&warned=1",
} satisfies Record<AdminLinkFilter, string>;

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

/** How many links each filter holds, under the same search and org. */
export const useAdminLinkCounts = (params: Omit<AdminLinksParams, "filter">) =>
  useQuery(adminLinkCountsQuery(params));

export const adminLinkCountsQuery = (params: Omit<AdminLinksParams, "filter">) =>
  queryOptions<AdminLinkCounts>({
    queryKey: ["admin", "links", "counts", params],
    queryFn: () =>
      api(
        `/admin/links/counts?q=${encodeURIComponent(params.q)}` +
          (params.org ? `&org=${encodeURIComponent(params.org)}` : ""),
      ),
    placeholderData: keepPreviousData,
  });
