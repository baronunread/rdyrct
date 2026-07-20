import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { authClient } from "./auth-client";
import type {
  Me,
  AppConfig,
  LinkDTO,
  LinkInput,
  MemberDTO,
  InviteDTO,
  DomainDTO,
  OrgStats,
  AdminOverview,
  AdminOrgRow,
  AdminOrgDetail,
  AdminUserRow,
} from "@/shared/types";

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ["user"],
    queryFn: async () => {
      try {
        return await api<Me>("/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
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
    mutationFn: () => authClient.signOut(),
    onSuccess: () => qc.setQueryData(["user"], null),
  });
}

export const useLinks = (orgId: string) =>
  useQuery<LinkDTO[]>({
    queryKey: ["links", orgId],
    queryFn: () => api(`/orgs/${orgId}/links`),
  });

export function useLinkMutations(orgId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["links", orgId] });
    qc.invalidateQueries({ queryKey: ["stats", orgId] });
  };
  const create = useMutation({
    mutationFn: (body: LinkInput) =>
      api<LinkDTO>(`/orgs/${orgId}/links`, { method: "POST", body }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: LinkInput & { id: string }) =>
      api<LinkDTO>(`/orgs/${orgId}/links/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${orgId}/links/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  return { create, update, remove };
}

export const useStats = (orgId: string) =>
  useQuery<OrgStats>({
    queryKey: ["stats", orgId],
    queryFn: () => api(`/orgs/${orgId}/stats`),
  });

export const useMembers = (orgId: string) =>
  useQuery<MemberDTO[]>({
    queryKey: ["members", orgId],
    queryFn: () => api(`/orgs/${orgId}/members`),
  });

export const useInvites = (orgId: string, enabled: boolean) =>
  useQuery<InviteDTO[]>({
    queryKey: ["invites", orgId],
    queryFn: () => api(`/orgs/${orgId}/invites`),
    enabled,
  });

export const useDomains = (orgId: string, enabled = true) =>
  useQuery<DomainDTO[]>({
    queryKey: ["domains", orgId],
    queryFn: () => api(`/orgs/${orgId}/domains`),
    enabled,
    // The backend advances the pipeline on read, so polling the list is all
    // it takes — poll while any domain is still in a transitional state.
    refetchInterval: (query) =>
      query.state.data?.some((d) => d.status !== "active" && d.status !== "error")
        ? 10_000
        : false,
  });

export function useDomainMutations(orgId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["domains", orgId] });
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
    mutationFn: (id: string) =>
      api(`/orgs/${orgId}/domains/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  return { add, refresh, setRootRedirect, remove };
}

// Billing is per-user (the caller's own subscription), so no orgId.
export function useCheckout() {
  return useMutation({
    mutationFn: () =>
      api<{ url: string }>(`/billing/checkout`, { method: "POST" }),
  });
}

export function usePortal() {
  return useMutation({
    mutationFn: () => api<{ url: string }>(`/billing/portal`),
  });
}

export const useAdminOverview = () =>
  useQuery<AdminOverview>({
    queryKey: ["admin", "overview"],
    queryFn: () => api("/admin/overview"),
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

export const useAdminUsers = () =>
  useQuery<AdminUserRow[]>({
    queryKey: ["admin", "users"],
    queryFn: () => api("/admin/users"),
  });
