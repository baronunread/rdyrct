import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type {
  Me,
  LinkDTO,
  LinkInput,
  MemberDTO,
  InviteDTO,
  OrgStats,
  AdminOverview,
  AdminOrgRow,
  AdminUserRow,
} from "@/shared/types";

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => qc.setQueryData(["me"], null),
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

export const useAdminUsers = () =>
  useQuery<AdminUserRow[]>({
    queryKey: ["admin", "users"],
    queryFn: () => api("/admin/users"),
  });
