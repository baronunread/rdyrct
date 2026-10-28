import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";

/**
 * The "Signing in" group on Settings, read straight from BetterAuth's own
 * endpoints: which ways in an account has (`/list-accounts`), which other
 * browsers hold a session (`/list-sessions`), and the three changes a person
 * makes to them. Nothing here goes through our API, so nothing new is needed
 * on the worker.
 */

/** One way into the account: "credential" is the password, "google" Google. */
export interface LinkedAccount {
  /** BetterAuth's row id, which is what unlinking takes. */
  id: string;
  providerId: string;
}

/** A signed-in browser, as BetterAuth lists it. The IP address it also
 * carries is never shown: the product does not show anybody an IP. */
export interface SessionRow {
  id: string;
  token: string;
  updatedAt: Date;
  userAgent?: string | null;
}

/** Throws BetterAuth's message, so a mutation's error toast can say it. */
function unwrap<T>(result: { data: T | null; error: { message?: string } | null }): T {
  if (result.error || result.data === null)
    throw new Error(result.error?.message || "Something went wrong");
  return result.data;
}

export function useLinkedAccounts() {
  return useQuery<LinkedAccount[]>({
    queryKey: ["auth", "accounts"],
    queryFn: async () => unwrap(await authClient.listAccounts()),
  });
}

/** Every other browser signed in to this account, newest first. */
export function useOtherSessions() {
  return useQuery<SessionRow[]>({
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
}

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

/** Sends the browser to Google and back to Settings with the account
 * linked. Google sign-in is a generic OAuth provider on this app (see
 * better-auth.ts), which BetterAuth also accepts here. */
export async function connectGoogle(): Promise<void> {
  unwrap(await authClient.linkSocial({ provider: "google", callbackURL: "/settings" }));
}

/** "Safari on iPhone", "Chrome on Windows", read off a user agent string.
 * Falls back to "Another browser" for anything it cannot name. */
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
