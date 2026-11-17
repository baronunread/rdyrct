import { useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
  queryOptions,
} from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { authClient } from "./auth-client";
import { readCachedUser, writeCachedUser } from "./user-cache";
import { lastAuth, setLastAuth } from "./last-auth";
import posthog from "./posthog";
import { FUNNEL, captureGoogleSignup } from "./funnel";
import type { LinkImportDTO } from "@/shared/link-import";
import { isOverLimit } from "@/shared/types";
import type {
  BillingDetails,
  CurrentUser,
  AppConfig,
  AddressDTO,
  LinkDTO,
  LinkInput,
  MemberDTO,
  InviteDTO,
  DomainDTO,
  RecentClick,
  AdminReportRow,
  AdminBlockedHostRow,
  AdminOrgDetail,
  AdminAnonLinkRow,
  AdminActionRow,
  QuotaUsage,
  WithQuotaUsage,
  ApiKeyDTO,
  OrgPlan,
  ClickUsage,
} from "@/shared/types";

// `enabled: false` is for marketing pages: a signed-out visitor has no session, and the 401
// was logged by the browser as a page error on every first landing visit. Every caller that
// decides or submits leaves it enabled and waits for the real answer.
export function useCurrentUser(enabled = true) {
  return useQuery({ ...userQuery, enabled });
}

// One definition for the hook and for the route loaders (lib/route-preload.ts),
// so both read and fill the same cache entry.
export const userQuery = queryOptions<CurrentUser | null>({
  queryKey: ["user"],
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
      captureGoogleSignup((event, props) => posthog.capture(event, props));
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

// Chrome only. Everything the app decides or submits keeps reading `useCurrentUser`
// and waits for the round trip: the cache is one page load out of date by definition,
// so a reload must not hand over a form that still preselects an old default domain.
export function useShellUser(): CurrentUser | null {
  const currentUser = useCurrentUser();
  const [cached] = useState(readCachedUser);
  // Once /user has answered, its answer wins, null (signed out) included.
  return currentUser.data !== undefined ? currentUser.data : (cached ?? null);
}

export const configQuery = queryOptions({
  queryKey: ["config"],
  queryFn: () => api<AppConfig>("/config"),
  staleTime: Infinity,
});

export const useConfig = () => useQuery(configQuery);

// No retry: when Polar fails the page falls back to the portal buttons,
// which beats a second wait for the same failure.
export const billingDetailsQuery = (enabled: boolean) =>
  queryOptions<BillingDetails>({
    queryKey: ["billingDetails"],
    queryFn: () => api("/billing/details"),
    enabled,
    staleTime: 60_000,
    // Back from the portal, possibly with a new card: ask again.
    refetchOnWindowFocus: "always",
    retry: false,
  });

export const useBillingDetails = (enabled: boolean) => useQuery(billingDetailsQuery(enabled));

export const useLinkHost = () => useConfig().data?.linkHost ?? window.location.host;

let signedOutOnPurpose = false;

// RequireAuth sends a deliberate sign-out to plain /login, so the URL carries no ?next=
// back to the page they chose to leave.
export function takeDeliberateSignOut(): boolean {
  const was = signedOutOnPurpose;
  signedOutOnPurpose = false;
  return was;
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut();
      if (error) throw new Error(error.message ?? "Could not sign out");
    },
    onSuccess: () => {
      signedOutOnPurpose = true;
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

// Searching, filtering and sorting are the server's job: the browser holds a page rather
// than the table, so anything it did itself would only apply to the rows on screen.
export const useLinks = (orgId: string, query: LinkQuery = {}) =>
  useQuery(linksQuery(orgId, query));

export const linksQuery = (orgId: string, query: LinkQuery = {}) =>
  queryOptions<LinkPage>({
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

// A link plus its kept-forever aliases each count (a rename's automatic 48h temp_alias never
// does), so this can run ahead of `useLinks(...).data.length`.
export const useLinkQuotaUsage = (orgId: string) => useQuery(linkQuotaUsageQuery(orgId));

export const linkQuotaUsageQuery = (orgId: string) =>
  queryOptions<CachedQuotaUsage>({
    queryKey: ["linkQuotaUsage", orgId],
    queryFn: () => api(`/orgs/${orgId}/links/quota-usage`),
    enabled: !!orgId,
  });

// A minute stale at most: nothing decides on it.
export const useClickUsage = (orgId: string) => useQuery(clickUsageQuery(orgId));

export const clickUsageQuery = (orgId: string) =>
  queryOptions<ClickUsage>({
    queryKey: ["clickUsage", orgId],
    queryFn: () => api(`/orgs/${orgId}/click-usage`),
    enabled: !!orgId,
    staleTime: 60_000,
  });

// Guarded by when the count was read: racing mutations can have their responses arrive out
// of order, so a response older than what is cached is dropped (#100).
function applyQuotaUsage(qc: ReturnType<typeof useQueryClient>, orgId: string, quota: QuotaUsage) {
  qc.setQueryData<CachedQuotaUsage>(["linkQuotaUsage", orgId], (prev) =>
    prev && prev.at > quota.quotaUsageAt
      ? prev
      : { count: quota.quotaUsage, at: quota.quotaUsageAt },
  );
}

// The server may have just reconciled an over-cap org back under (#486), and the banner,
// grace date and locks all come from the user query. An org that is fine skips the refetch.
export function refreshOverLimit(qc: ReturnType<typeof useQueryClient>, orgId: string) {
  const org = qc.getQueryData<CurrentUser | null>(["user"])?.orgs.find((o) => o.id === orgId);
  if (org && isOverLimit(org.over)) void qc.invalidateQueries({ queryKey: ["user"] });
}

export function useLinkMutations(orgId: string) {
  const qc = useQueryClient();
  const invalidate = (quota: QuotaUsage) => {
    void qc.invalidateQueries({ queryKey: ["links", orgId] });
    void qc.invalidateQueries({ queryKey: ["stats", orgId] });
    applyQuotaUsage(qc, orgId, quota);
    // A rename can leave the old slug behind as a temp alias: refetch any
    // addresses list already open for this org's links, not just on remount.
    void qc.invalidateQueries({ queryKey: ["addresses", orgId] });
  };
  const create = useMutation({
    mutationFn: (body: LinkInput) =>
      api<WithQuotaUsage<LinkDTO>>(`/orgs/${orgId}/links`, { method: "POST", body }),
    onSuccess: (link) => {
      invalidate(link);
      // Funnel step 7, the activation event (#64). On the hook rather than
      // the call sites, so the dashboard's quick-create and the links page both count.
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
    onSuccess: (quota) => {
      invalidate(quota);
      refreshOverLimit(qc, orgId);
    },
  });
  return { create, update, remove };
}

export const useAddresses = (orgId: string, linkId: string | null) =>
  useQuery(addressesQuery(orgId, linkId));

export const addressesQuery = (orgId: string, linkId: string | null) =>
  queryOptions<AddressDTO[]>({
    queryKey: ["addresses", orgId, linkId],
    queryFn: () => api(`/orgs/${orgId}/links/${linkId}/addresses`),
    enabled: !!orgId && !!linkId,
  });

export function useAddressMutations(orgId: string, linkId: string) {
  const qc = useQueryClient();
  const invalidate = (quota: QuotaUsage) => {
    void qc.invalidateQueries({ queryKey: ["addresses", orgId, linkId] });
    void qc.invalidateQueries({ queryKey: ["links", orgId] });
    void qc.invalidateQueries({ queryKey: ["linkStats", orgId] });
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
    onSuccess: (quota) => {
      invalidate(quota);
      refreshOverLimit(qc, orgId);
    },
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

// A cheap indexed read (limit rows by ts desc), so it polls while the page is open.
export const useRecentClicks = (orgId: string, limit = 8) =>
  useQuery(recentClicksQuery(orgId, limit));

export const recentClicksQuery = (orgId: string, limit = 8) =>
  queryOptions<RecentClick[]>({
    queryKey: ["recentClicks", orgId, limit],
    queryFn: () => api(`/orgs/${orgId}/clicks?limit=${limit}`),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

export const useMembers = (orgId: string) => useQuery(membersQuery(orgId));

export const membersQuery = (orgId: string) =>
  queryOptions<MemberDTO[]>({
    queryKey: ["members", orgId],
    queryFn: () => api(`/orgs/${orgId}/members`),
    enabled: !!orgId,
  });

export const useInvites = (orgId: string, enabled: boolean) =>
  useQuery(invitesQuery(orgId, enabled));

export const invitesQuery = (orgId: string, enabled = true) =>
  queryOptions<InviteDTO[]>({
    queryKey: ["invites", orgId],
    queryFn: () => api(`/orgs/${orgId}/invites`),
    enabled: enabled && !!orgId,
  });

export const useDomains = (orgId: string, enabled = true, every = 10_000) =>
  useQuery(domainsQuery(orgId, enabled, every));

export const domainsQuery = (orgId: string, enabled = true, every = 10_000) =>
  queryOptions<DomainDTO[]>({
    queryKey: ["domains", orgId],
    queryFn: () => api(`/orgs/${orgId}/domains`),
    enabled: enabled && !!orgId,
    // A background Workflow drives DNS/TLS activation independently; this
    // just polls to reflect that progress while any domain is transitional.
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status !== "active" && d.status !== "error") ? every : false,
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
  // A read, not a poll: re-checking only re-reads what the activation workflow
  // last wrote (#104), and nothing polls it.
  const refresh = useMutation({
    mutationFn: (id: string) => api<DomainDTO>(`/orgs/${orgId}/domains/${id}`),
    onSuccess: invalidate,
  });
  const retry = useMutation({
    mutationFn: (id: string) =>
      api<DomainDTO>(`/orgs/${orgId}/domains/${id}/retry`, { method: "POST" }),
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
    onSuccess: () => {
      void invalidate();
      refreshOverLimit(qc, orgId);
    },
  });
  // The default lives on the org, not the domain, so this invalidates
  // ["user"]: that is where the app reads the org from (#69).
  const setDefault = useMutation({
    mutationFn: (id: string | null) =>
      api(`/orgs/${orgId}`, { method: "PATCH", body: { defaultDomainId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user"] }),
  });
  return { add, refresh, retry, setRootRedirect, remove, setDefault };
}

// API keys (#131): minted per-user but scoped through an owned org (the
// route is owner-only).
export const useApiKeys = (orgId: string, enabled = true) => useQuery(apiKeysQuery(orgId, enabled));

export const apiKeysQuery = (orgId: string, enabled = true) =>
  queryOptions<ApiKeyDTO[]>({
    queryKey: ["api-keys", orgId],
    queryFn: () => api(`/orgs/${orgId}/api-keys`),
    enabled: enabled && !!orgId,
  });

export function useApiKeyMutations(orgId: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["api-keys", orgId] });
  const create = useMutation({
    mutationFn: (name: string) =>
      api<ApiKeyDTO>(`/orgs/${orgId}/api-keys`, { method: "POST", body: { name } }),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/orgs/${orgId}/api-keys/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  return { create, revoke };
}

export interface ConnectedApp {
  id: string;
  clientId: string;
  clientName: string;
  createdAt: Date;
  lastUsedAt: Date;
}

// An OAuth grant is per-user with no owner gate: any member sees and revokes their own
// connections. `polling` is on while the connect wizard waits for a new grant, the only signal
// there is (no webhook), and off once it shows or the person leaves.
export const useConnectedApps = (polling = false) => useQuery(connectedAppsQuery(polling));

export const connectedAppsQuery = (polling = false) =>
  queryOptions<ConnectedApp[]>({
    queryKey: ["connected-apps"],
    refetchInterval: polling ? 3000 : false,
    queryFn: async () => {
      const rows = await api<
        {
          id: string;
          clientId: string;
          clientName: string;
          createdAt: number;
          lastUsedAt: number;
        }[]
      >("/oauth-connections");
      return rows.map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt),
        lastUsedAt: new Date(row.lastUsedAt),
      }));
    },
  });

// Not authClient.oauth2.deleteConsent: better-auth's endpoint only deletes the consent row,
// leaving any token it already minted live. This route (oauth-connections.ts) deletes those too.
export function useRevokeConnectedApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/oauth-connections/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["connected-apps"] }),
  });
}

// These two only fetch a Polar redirect URL, then the browser leaves the app. Plan changes
// arrive via the Polar webhook and are picked up by polling ["user"] on return to /billing.
export function useCheckout() {
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: ({
      plan,
      interval,
      from = "billing",
    }: {
      plan: "hobby" | "pro";
      interval: "month" | "year";
      from?: "billing" | "welcome";
    }) => {
      const body = from === "welcome" ? { plan, interval, from } : { plan, interval };
      return api<{ url: string }>(`/billing/checkout`, { method: "POST", body });
    },
  });
}

export function usePortal() {
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: () => api<{ url: string }>(`/billing/portal`, { method: "POST" }),
  });
}

export function useConfirmCheckout() {
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (checkoutId: string) =>
      api<{ plan: OrgPlan }>(`/billing/checkout/${checkoutId}/confirm`, { method: "POST" }),
  });
}

export const useAdminOrgDetail = (orgId: string | null) =>
  useQuery<AdminOrgDetail>({
    queryKey: ["admin", "org", orgId],
    queryFn: () => api(`/admin/orgs/${orgId}`),
    enabled: !!orgId,
  });

export const useAdminAnonLinks = () => useQuery(adminAnonLinksQuery);

export const adminAnonLinksQuery = queryOptions<AdminAnonLinkRow[]>({
  queryKey: ["admin", "anon-links"],
  queryFn: () => api("/admin/links/anonymous"),
});

export const useAdminReports = () => useQuery(adminReportsQuery);

export const adminReportsQuery = queryOptions<AdminReportRow[]>({
  queryKey: ["admin", "reports"],
  queryFn: () => api("/admin/links/reports"),
});

export const useAdminBlockedHosts = () => useQuery(adminBlockedHostsQuery);

export const adminBlockedHostsQuery = queryOptions<AdminBlockedHostRow[]>({
  queryKey: ["admin", "blocked-hosts"],
  queryFn: () => api("/admin/links/blocked-hosts"),
});

export const useAdminAudit = () => useQuery(adminAuditQuery);

export const adminAuditQuery = queryOptions<AdminActionRow[]>({
  queryKey: ["admin", "audit"],
  queryFn: () => api("/admin/audit"),
});

interface DnsRecordDTO {
  type: "TXT" | "CNAME";
  name: string;
  value: string;
}

// A domain moving from another service needs two TXT records whose values Cloudflare
// mints a few seconds after the domain is added, so this asks again until they are there (#383).
export const useDomainRecords = (orgId: string, domainId: string, enabled = true) =>
  useQuery<{ records: DnsRecordDTO[] }>({
    queryKey: ["domain-records", orgId, domainId],
    queryFn: () => api(`/orgs/${orgId}/domains/${domainId}/records`),
    enabled: enabled && !!orgId && !!domainId,
    refetchInterval: (query) =>
      query.state.data?.records.some((record) => record.type === "TXT") === false ? 3_000 : false,
  });

export const useLinkImport = (orgId: string) => useQuery(linkImportQuery(orgId));

export const linkImportQuery = (orgId: string) =>
  queryOptions<{ import: LinkImportDTO | null }>({
    queryKey: ["link-import", orgId],
    queryFn: () => api(`/orgs/${orgId}/link-import/current`),
    enabled: !!orgId,
    refetchInterval: (query) => (query.state.data?.import?.status === "running" ? 2_000 : false),
  });
