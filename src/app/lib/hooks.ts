import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { authClient } from "./auth-client";
import { writeAuthHint } from "./auth-hint";
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
} from "@/shared/types";

export function useCurrentUser() {
  return useQuery<CurrentUser | null>({
    queryKey: ["user"],
    queryFn: async () => {
      try {
        const user = await api<CurrentUser>("/user");
        writeAuthHint(true);
        posthog.identify(user.user.id, {
          email: user.user.email,
          name: user.user.name,
          plan: user.user.plan,
          is_admin: user.user.isAdmin,
        });
        return user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          writeAuthHint(false);
          return null;
        }
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
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
      writeAuthHint(false);
      qc.setQueryData(["user"], null);
      qc.removeQueries({
        predicate: (query) => query.queryKey[0] !== "config" && query.queryKey[0] !== "user",
      });
    },
  });
}

// Org-scoped queries guard on orgId: a user with no organization yet renders
// the pages' empty states, and these must not fire at /orgs//… meanwhile.
export const useLinks = (orgId: string) =>
  useQuery<LinkDTO[]>({
    queryKey: ["links", orgId],
    queryFn: () => api(`/orgs/${orgId}/links`),
    enabled: !!orgId,
  });

/** Links used against the plan's `links` cap: a link plus its kept-forever
 * aliases each count (a rename's automatic 48h temp_alias never does), so
 * this can run ahead of `useLinks(...).data.length`. */
export const useLinkQuotaUsage = (orgId: string) =>
  useQuery<{ count: number }>({
    queryKey: ["linkQuotaUsage", orgId],
    queryFn: () => api(`/orgs/${orgId}/links/quota-usage`),
    enabled: !!orgId,
  });

export function useLinkMutations(orgId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["links", orgId] });
    qc.invalidateQueries({ queryKey: ["stats", orgId] });
    qc.invalidateQueries({ queryKey: ["linkQuotaUsage", orgId] });
    // A rename can leave the old slug behind as a temp alias: refetch any
    // addresses list already open for this org's links, not just on remount.
    qc.invalidateQueries({ queryKey: ["addresses", orgId] });
  };
  const create = useMutation({
    mutationFn: (body: LinkInput) => api<LinkDTO>(`/orgs/${orgId}/links`, { method: "POST", body }),
    onSuccess: (link) => {
      invalidate();
      // Funnel step 7, the activation event (#64). On the hook rather than
      // the call sites, so the dashboard's quick-create and the links page
      // both count and neither can be forgotten.
      posthog.capture(FUNNEL.linkCreated, { on_custom_domain: Boolean(link.domainId) });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: LinkInput & { id: string }) =>
      api<LinkDTO>(`/orgs/${orgId}/links/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/orgs/${orgId}/links/${id}`, { method: "DELETE" }),
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
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["addresses", orgId, linkId] });
    qc.invalidateQueries({ queryKey: ["links", orgId] });
    qc.invalidateQueries({ queryKey: ["linkStats", orgId] });
    qc.invalidateQueries({ queryKey: ["linkQuotaUsage", orgId] });
  };
  const keepForever = useMutation({
    mutationFn: (addressId: string) =>
      api(`/orgs/${orgId}/links/${linkId}/addresses/${addressId}/keep-forever`, { method: "POST" }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (addressId: string) =>
      api(`/orgs/${orgId}/links/${linkId}/addresses/${addressId}/remove`, {
        method: "POST",
        body: { confirm: true },
      }),
    onSuccess: invalidate,
  });
  const promote = useMutation({
    mutationFn: (addressId: string) =>
      api<LinkDTO>(`/orgs/${orgId}/links/${linkId}/addresses/${addressId}/promote`, {
        method: "POST",
      }),
    onSuccess: invalidate,
  });
  const create = useMutation({
    mutationFn: (body: { slug?: string }) =>
      api<LinkDTO>(`/orgs/${orgId}/links/${linkId}/addresses`, { method: "POST", body }),
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
  const refresh = useMutation({
    mutationFn: (id: string) =>
      api<DomainDTO>(`/orgs/${orgId}/domains/${id}/refresh`, {
        method: "POST",
      }),
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
    mutationFn: () => api<{ url: string }>(`/billing/portal`),
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
export const useAdminLinks = (params: { q: string; suspended: boolean }) =>
  useQuery<AdminLinkRow[]>({
    queryKey: ["admin", "links", params],
    queryFn: () =>
      api(
        `/admin/links?q=${encodeURIComponent(params.q)}${params.suspended ? "&suspended=1" : ""}`,
      ),
  });

export const useAdminAnonLinks = () =>
  useQuery<AdminAnonLinkRow[]>({
    queryKey: ["admin", "anon-links"],
    queryFn: () => api("/admin/links/anonymous"),
  });

export const useAdminAudit = () =>
  useQuery<AdminActionRow[]>({
    queryKey: ["admin", "audit"],
    queryFn: () => api("/admin/links/audit"),
  });

export const useAdminUsers = () =>
  useQuery<AdminUserRow[]>({
    queryKey: ["admin", "users"],
    queryFn: () => api("/admin/users"),
  });
