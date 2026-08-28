import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { authClient } from "./auth-client";
import { readCachedUser, writeCachedUser } from "./user-cache";
import { lastAuth, setLastAuth } from "./last-auth";
import posthog from "./posthog";
import { FUNNEL } from "./funnel";
import type {
  CurrentUser,
  AppConfig,
  AddressDTO,
  LinkDTO,
  LinkInput,
  MemberDTO,
  InviteDTO,
  DomainDTO,
  OrgStats,
  LinkStats,
  RecentClick,
  AdminUsage,
  AdminOrgRow,
  AdminOrgDetail,
  AdminUserRow,
  AdminLinkRow,
  AdminAnonLinkRow,
  AdminActionRow,
  QuotaUsage,
  WithQuotaUsage,
} from "@/shared/types";

/**
 * `enabled: false` is for the marketing pages, which ask this only to choose
 * between "Sign up" and "Open dashboard". A signed-out visitor has no session
 * to find, and the 401 that came back was logged by the browser as a page
 * error on every first visit to the landing page. Skipping the round trip for
 * a browser that has never been signed in (see useAudience) costs that visitor
 * nothing and saves them a request. Every caller that decides or submits
 * anything leaves it enabled and waits for the real answer.
 */
export function useCurrentUser(enabled = true) {
  return useQuery<CurrentUser | null>({
    queryKey: ["user"],
    enabled,
    queryFn: async () => {
      try {
        const user = await api<CurrentUser>("/user");
        writeCachedUser(user);
        posthog.identify(user.user.id, {
          email: user.user.email,
          name: user.user.name,
          plan: user.user.plan,
          is_admin: user.user.isAdmin,
        });
        // Backfill the Google address once the OAuth round trip lands, so a
        // later visit to /login can offer "continue as <email>".
        if (lastAuth()?.method === "google" && lastAuth()?.email !== user.user.email) {
          setLastAuth("google", user.user.email);
        }
        return user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          writeCachedUser(null);
          return null;
        }
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Who the shell draws itself as: the checked answer when it is here, the last
 * one otherwise, so a reload paints the sidebar instead of a skeleton.
 *
 * Chrome only. Everything the app decides or submits keeps reading
 * `useCurrentUser` and keeps waiting for the round trip, because the cache is
 * one page load out of date by definition: somebody who changes their org's
 * default domain and reloads must not be handed a form that still preselects
 * the old one.
 *
 * Snapshotted once per mount: mid-visit changes come from the query.
 */
export function useShellUser(): CurrentUser | null {
  const currentUser = useCurrentUser();
  const [cached] = useState(readCachedUser);
  return currentUser.data ?? cached ?? null;
}

// Deployment config (e.g. appHost for DNS instructions) — static per deploy.
export const useConfig = () =>
  useQuery<AppConfig>({
    queryKey: ["config"],
    queryFn: () => api("/config"),
    staleTime: Infinity,
  });

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Could not sign out");
    },
    onSuccess: () => {
      posthog.reset();
      writeCachedUser(null);
      qc.setQueryData(["user"], null);
      qc.removeQueries({
        predicate: (query) => query.queryKey[0] !== "config" && query.queryKey[0] !== "user",
      });
    },
  });
}

// Org-scoped queries guard on orgId: a user with no organization yet renders
// the pages' empty states, and these must not fire at /orgs//… meanwhile.
export interface LinkQuery {
  q?: string;
  domain?: string;
  sort?: "created" | "slug" | "clicks";
  dir?: "asc" | "desc";
  limit?: number;
  cursor?: string | null;
}

interface LinkPage {
  items: LinkDTO[];
  nextCursor: string | null;
}

/**
 * One page of links, with the cursor that continues it.
 *
 * Searching, filtering and sorting are all the server's job now: the browser
 * holds a page rather than the table, so anything it did itself would only
 * ever apply to the rows already on screen.
 */
export const useLinks = (orgId: string, query: LinkQuery = {}) =>
  useQuery<LinkPage>({
    queryKey: ["links", orgId, query],
    queryFn: () => api(`/orgs/${orgId}/links?${linkQueryString(query)}`),
    enabled: !!orgId,
    // Without this every keystroke's pause replaced the table with a
    // skeleton and put it back, which flashes and tears out an open menu.
    placeholderData: keepPreviousData,
  });

function linkQueryString(query: LinkQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.domain && query.domain !== "all") params.set("domain", query.domain);
  if (query.sort && query.sort !== "created") params.set("sort", query.sort);
  if (query.dir === "asc") params.set("dir", "asc");
  if (query.limit) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  return params.toString();
}

interface CachedQuotaUsage {
  count: number;
  at: number;
}

/** Links used against the plan's `links` cap: a link plus its kept-forever
 * aliases each count (a rename's automatic 48h temp_alias never does), so
 * this can run ahead of `useLinks(...).data.length`. */
export const useLinkQuotaUsage = (orgId: string) =>
  useQuery<CachedQuotaUsage>({
    queryKey: ["linkQuotaUsage", orgId],
    queryFn: () => api(`/orgs/${orgId}/links/quota-usage`),
    enabled: !!orgId,
  });

/** Seeds the quota cache from a mutation response instead of a follow-up GET
 * /links/quota-usage (#100), guarded by when the count was read: two
 * mutations racing can have their responses arrive in the opposite order
 * from the writes that produced them, so a response older than what's
 * already cached is dropped instead of clobbering a fresher count. */
function applyQuotaUsage(qc: ReturnType<typeof useQueryClient>, orgId: string, quota: QuotaUsage) {
  qc.setQueryData<CachedQuotaUsage>(["linkQuotaUsage", orgId], (prev) =>
    prev && prev.at > quota.quotaUsageAt
      ? prev
      : { count: quota.quotaUsage, at: quota.quotaUsageAt },
  );
}

export function useLinkMutations(orgId: string) {
  const qc = useQueryClient();
  const invalidate = (quota: QuotaUsage) => {
    qc.invalidateQueries({ queryKey: ["links", orgId] });
    qc.invalidateQueries({ queryKey: ["stats", orgId] });
    applyQuotaUsage(qc, orgId, quota);
    // A rename can leave the old slug behind as a temp alias: refetch any
    // addresses list already open for this org's links, not just on remount.
    qc.invalidateQueries({ queryKey: ["addresses", orgId] });
  };
  const create = useMutation({
    mutationFn: (body: LinkInput) =>
      api<WithQuotaUsage<LinkDTO>>(`/orgs/${orgId}/links`, { method: "POST", body }),
    onSuccess: (link) => {
      invalidate(link);
      // Funnel step 7, the activation event (#64). On the hook rather than
      // the call sites, so the dashboard's quick-create and the links page
      // both count and neither can be forgotten.
      posthog.capture(FUNNEL.linkCreated, { on_custom_domain: Boolean(link.domainId) });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: LinkInput & { id: string }) =>
      api<WithQuotaUsage<LinkDTO>>(`/orgs/${orgId}/links/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api<WithQuotaUsage<{ ok: true }>>(`/orgs/${orgId}/links/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export const useStats = (orgId: string, days?: number, bucket?: "day" | "hour") =>
  useQuery<OrgStats>({
    queryKey: ["stats", orgId, days, bucket],
    queryFn: () => {
      const params = new URLSearchParams();
      if (days) params.set("days", String(days));
      if (bucket) params.set("bucket", bucket);
      const qs = params.size ? `?${params.toString()}` : "";
      return api<OrgStats>(`/orgs/${orgId}/stats${qs}`);
    },
    enabled: !!orgId,
  });

export const useLinkStats = (orgId: string, slug: string | null, domain?: string | null) =>
  useQuery<LinkStats>({
    queryKey: ["linkStats", orgId, slug, domain],
    queryFn: () => {
      let path = `/orgs/${orgId}/links/stats/${encodeURIComponent(slug!)}`;
      if (domain) path += `?domain=${encodeURIComponent(domain)}`;
      return api<LinkStats>(path);
    },
    enabled: !!orgId && !!slug,
  });

// A link's primary address plus every alias (temporary, permanent, expired).
// See #38.
export const useAddresses = (orgId: string, linkId: string | null) =>
  useQuery<AddressDTO[]>({
    queryKey: ["addresses", orgId, linkId],
    queryFn: () => api(`/orgs/${orgId}/links/${linkId}/addresses`),
    enabled: !!orgId && !!linkId,
  });

export function useAddressMutations(orgId: string, linkId: string) {
  const qc = useQueryClient();
  const invalidate = (quota: QuotaUsage) => {
    qc.invalidateQueries({ queryKey: ["addresses", orgId, linkId] });
    qc.invalidateQueries({ queryKey: ["links", orgId] });
    qc.invalidateQueries({ queryKey: ["linkStats", orgId] });
    applyQuotaUsage(qc, orgId, quota);
  };
  const address = (addressId: string) => `/orgs/${orgId}/links/${linkId}/addresses/${addressId}`;
  const keepForever = useMutation({
    mutationFn: (addressId: string) =>
      api<WithQuotaUsage<{ ok: true }>>(address(addressId), {
        method: "PATCH",
        body: { kind: "permanent" },
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (addressId: string) =>
      api<WithQuotaUsage<{ ok: true }>>(address(addressId), { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const promote = useMutation({
    mutationFn: (addressId: string) =>
      api<WithQuotaUsage<LinkDTO>>(address(addressId), {
        method: "PATCH",
        body: { kind: "primary" },
      }),
    onSuccess: invalidate,
  });
  const create = useMutation({
    mutationFn: (body: { slug?: string }) =>
      api<WithQuotaUsage<LinkDTO>>(`/orgs/${orgId}/links/${linkId}/addresses`, {
        method: "POST",
        body,
      }),
    onSuccess: invalidate,
  });
  return { keepForever, remove, promote, create };
}

// The dashboard's live pulse: a cheap indexed read (limit rows by ts desc),
// so it polls while the page is open.
export const useRecentClicks = (orgId: string, limit = 8) =>
  useQuery<RecentClick[]>({
    queryKey: ["recentClicks", orgId, limit],
    queryFn: () => api(`/orgs/${orgId}/clicks?limit=${limit}`),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

export const useMembers = (orgId: string) =>
  useQuery<MemberDTO[]>({
    queryKey: ["members", orgId],
    queryFn: () => api(`/orgs/${orgId}/members`),
    enabled: !!orgId,
  });

export const useInvites = (orgId: string, enabled: boolean) =>
  useQuery<InviteDTO[]>({
    queryKey: ["invites", orgId],
    queryFn: () => api(`/orgs/${orgId}/invites`),
    enabled: enabled && !!orgId,
  });

export const useDomains = (orgId: string, enabled = true) =>
  useQuery<DomainDTO[]>({
    queryKey: ["domains", orgId],
    queryFn: () => api(`/orgs/${orgId}/domains`),
    enabled: enabled && !!orgId,
    // A background Workflow drives DNS/TLS activation independently; this
    // just polls to reflect that progress while any domain is transitional.
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status !== "active" && d.status !== "error") ? 10_000 : false,
  });

export function useDomainMutations(orgId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["domains", orgId] });
  const add = useMutation({
    mutationFn: (hostname: string) =>
      api<DomainDTO>(`/orgs/${orgId}/domains`, {
        method: "POST",
        body: { hostname },
      }),
    onSuccess: invalidate,
  });
  // A read, triggered by a button: re-checking a domain only re-reads what the
  // activation workflow last wrote (#104). It lives here rather than in a
  // query because nothing polls it, somebody asks for it.
  const refresh = useMutation({
    mutationFn: (id: string) => api<DomainDTO>(`/orgs/${orgId}/domains/${id}`),
    onSuccess: invalidate,
  });
  const setRootRedirect = useMutation({
    mutationFn: ({ id, rootRedirect }: { id: string; rootRedirect: string }) =>
      api<DomainDTO>(`/orgs/${orgId}/domains/${id}`, {
        method: "PATCH",
        body: { rootRedirect },
      }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/orgs/${orgId}/domains/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  // The default lives on the org, not the domain, so this invalidates
  // ["user"]: that is where the app reads the org from (#69).
  const setDefault = useMutation({
    mutationFn: (id: string | null) =>
      api(`/orgs/${orgId}`, { method: "PATCH", body: { defaultDomainId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user"] }),
  });
  return { add, refresh, setRootRedirect, remove, setDefault };
}

// Billing is per-user (the caller's own subscription), so no orgId.
// These two only fetch a Polar redirect URL, then the browser leaves the app —
// nothing in the cache goes stale. Plan changes arrive via the Polar webhook
// and are picked up by polling ["user"] on the return to /billing.
export function useCheckout() {
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (plan: "hobby" | "pro") =>
      api<{ url: string }>(`/billing/checkout`, {
        method: "POST",
        body: { plan },
      }),
  });
}

export function usePortal() {
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: () => api<{ url: string }>(`/billing/portal`, { method: "POST" }),
  });
}

export const useAdminUsage = () =>
  useQuery<AdminUsage>({
    queryKey: ["admin", "usage"],
    queryFn: () => api("/admin/usage"),
  });

export const useAdminOrgs = () =>
  useQuery<AdminOrgRow[]>({
    queryKey: ["admin", "orgs"],
    queryFn: () => api("/admin/orgs"),
  });

export const useAdminOrgDetail = (orgId: string | null) =>
  useQuery<AdminOrgDetail>({
    queryKey: ["admin", "org", orgId],
    queryFn: () => api(`/admin/orgs/${orgId}`),
    enabled: !!orgId,
  });

/** The cross-org link list (#67).
 *
 * The search goes to the server, because the table can hold far more links
 * than a browser should filter. Ordering does not: the response is capped, so
 * sorting it is a client concern and the column headers can drive it the way
 * every other table here works. */
export const useAdminLinks = (params: { q: string; suspended: boolean; org?: string }) =>
  useQuery<AdminLinkRow[]>({
    queryKey: ["admin", "links", params],
    queryFn: () =>
      api(
        `/admin/links?q=${encodeURIComponent(params.q)}${params.suspended ? "&suspended=1" : ""}` +
          (params.org ? `&org=${encodeURIComponent(params.org)}` : ""),
      ),
    // The search term is part of the key, so without this every pause in
    // typing replaced the table with a skeleton and put it back. That flashes,
    // and it also tears out whatever the admin had open: a row's actions menu
    // is unmounted mid-click when the new page of results lands.
    placeholderData: keepPreviousData,
  });

export const useAdminAnonLinks = () =>
  useQuery<AdminAnonLinkRow[]>({
    queryKey: ["admin", "anon-links"],
    queryFn: () => api("/admin/links/anonymous"),
  });

export const useAdminAudit = () =>
  useQuery<AdminActionRow[]>({
    queryKey: ["admin", "audit"],
    queryFn: () => api("/admin/audit"),
  });

export const useAdminUsers = () =>
  useQuery<AdminUserRow[]>({
    queryKey: ["admin", "users"],
    queryFn: () => api("/admin/users"),
  });
