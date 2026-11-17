import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";

// Nothing here goes through our API: a Google account's `email` is an additional field on
// BetterAuth's account (better-auth.ts), so `/list-accounts` returns it.

export interface LinkedAccount {
  id: string;
  providerId: string;
  email?: string | null;
}

// The IP address it also carries is never shown: the product does not show anybody an IP.
export interface SessionRow {
  id: string;
  token: string;
  updatedAt: Date;
  userAgent?: string | null;
}

function unwrap<T>(result: { data: T | null; error: { message?: string } | null }): T {
  if (result.error || result.data === null)
    throw new Error(result.error?.message || "Something went wrong");
  return result.data;
}

export const useLinkedAccounts = () => useQuery(linkedAccountsQuery);

export const linkedAccountsQuery = queryOptions<LinkedAccount[]>({
  queryKey: ["auth", "accounts"],
  queryFn: async () => unwrap(await authClient.listAccounts()),
});

export const useOtherSessions = () => useQuery(otherSessionsQuery);

export const otherSessionsQuery = queryOptions<SessionRow[]>({
  queryKey: ["auth", "sessions"],
  queryFn: async () => {
    const [sessions, current] = await Promise.all([
      authClient.listSessions(),
      authClient.getSession(),
    ]);
    const mine = current.data?.session.token;
    return unwrap(sessions)
      .filter((s) => s.token !== mine)
      .map((s) => ({ ...s, updatedAt: new Date(s.updatedAt) }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  },
});

export function useSignOutOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await authClient.revokeOtherSessions()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "sessions"] }),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions: boolean;
    }) => unwrap(await authClient.changePassword(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "sessions"] }),
  });
}

export function useDisconnectGoogle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => unwrap(await authClient.unlinkAccount({ accountId })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "accounts"] }),
  });
}

// Google sign-in is a generic OAuth provider on this app (see
// better-auth.ts), which BetterAuth also accepts here.
export async function connectGoogle(): Promise<void> {
  unwrap(await authClient.linkSocial({ provider: "google", callbackURL: "/settings" }));
}

export function deviceName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "a Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `A browser on ${system}` : "Another browser");
}
