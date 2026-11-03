/**
 * What a page needs before its first frame, fetched while the page you are
 * leaving is still on screen.
 *
 * Every app route has a loader (main.tsx) that calls `loadPage`: it finds the
 * signed-in user and the current org the same way the page will, loads the
 * page's chunk, and runs the `preload` that module exports. A preload asks
 * TanStack Query for exactly the entries the page's first render reads, with
 * the same factories its hooks use, so the page mounts onto a warm cache and
 * draws whole instead of a skeleton that fills in section by section.
 *
 * Hovering a link runs the same loader (`defaultPreload: "intent"`), which is
 * why most clicks land on a page that is already fetched.
 *
 * A preload never decides anything and never fails a navigation: no user, no
 * org or an error all end here quietly, and the page renders its own empty or
 * error state from the query it would have run anyway.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { CurrentUser, UserOrg } from "@/shared/types";
import { configQuery, userQuery } from "./hooks";
import { pickOrg } from "./current-org";

/** Where the page is going: its path params and raw query string. */
export interface PageTarget {
  params: Record<string, string>;
  /** The query string as `useSearchParams` reads it, "?tab=mcp" or "". */
  searchStr: string;
}

export interface PageContext extends PageTarget {
  org: UserOrg;
  user: CurrentUser;
}

export type PagePreload = (qc: QueryClient, orgId: string, page: PageContext) => Promise<void>;

/** Waits for every fetch a page asked for, whatever each one's outcome: one
 * failure must not cut the wait for the rest short. */
export async function settle(
  work: readonly (PromiseLike<object | null | void> | undefined)[],
): Promise<void> {
  await Promise.allSettled(work);
}

/**
 * The signed-in user and the page module, and config alongside: short-link
 * hosts are drawn from it on most pages (useLinkHost), the Platform header
 * reads it too, and it never changes within a deploy.
 *
 * Never rejects: a failure is the page's to show, from the query it asks
 * again on mount. Null means there is nothing to preload.
 */
async function userAndPage<M>(
  qc: QueryClient,
  importPage: () => Promise<M>,
): Promise<{ user: CurrentUser; page: M } | null> {
  try {
    const [user, page] = await Promise.all([
      qc.ensureQueryData(userQuery),
      importPage(),
      qc.ensureQueryData(configQuery).catch(() => undefined),
    ]);
    return user ? { user, page } : null;
  } catch {
    return null;
  }
}

/** What a page reads that belongs to the account rather than an org (Settings'
 * sign-in methods and sessions): preloaded even for somebody with no org. */
export type AccountPreload = (qc: QueryClient) => Promise<void>;

export async function loadPage(
  qc: QueryClient,
  importPage: () => Promise<{ preload: PagePreload; preloadAccount?: AccountPreload }>,
  target: PageTarget,
): Promise<void> {
  const loaded = await userAndPage(qc, importPage);
  if (!loaded) return;
  await loaded.page.preloadAccount?.(qc).catch(() => {});
  const org = pickOrg(loaded.user.orgs);
  if (!org) return;
  await loaded.page.preload(qc, org.id, { ...target, org, user: loaded.user }).catch(() => {});
}

/** A platform-admin page's preload: no org, and only the query string. */
export type AdminPagePreload = (qc: QueryClient, searchStr: string) => Promise<void>;

/** `loadPage` for /admin: the same, for platform admins only. Anybody else
 * gets the 404 page, which reads nothing. */
export async function loadAdminPage(
  qc: QueryClient,
  importPage: () => Promise<{ preload: AdminPagePreload }>,
  target: PageTarget,
): Promise<void> {
  const loaded = await userAndPage(qc, importPage);
  if (!loaded?.user.user.isAdmin) return;
  await loaded.page.preload(qc, target.searchStr).catch(() => {});
}
