// A preload never decides anything and never fails a navigation: no user, no org or an
// error all end quietly, and the page renders its own empty or error state.
import type { QueryClient } from "@tanstack/react-query";
import type { CurrentUser, UserOrg } from "@/shared/types";
import { configQuery, userQuery } from "./hooks";
import { pickOrg } from "./current-org";

export interface PageTarget {
  params: Record<string, string>;
  searchStr: string;
}

export interface PageContext extends PageTarget {
  org: UserOrg;
  user: CurrentUser;
}

export type PagePreload = (qc: QueryClient, orgId: string, page: PageContext) => Promise<void>;

// One failure must not cut the wait for the rest short.
export async function settle(
  work: readonly (PromiseLike<object | null | void> | undefined)[],
): Promise<void> {
  await Promise.allSettled(work.map((item) => Promise.resolve(item)));
}

// Config is here because short-link hosts are drawn from it on most pages and it never
// changes within a deploy. Never rejects: a failure is the page's to show.
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

export type AdminPagePreload = (qc: QueryClient, searchStr: string) => Promise<void>;

export async function loadAdminPage(
  qc: QueryClient,
  importPage: () => Promise<{ preload: AdminPagePreload }>,
  target: PageTarget,
): Promise<void> {
  const loaded = await userAndPage(qc, importPage);
  if (!loaded?.user.user.isAdmin) return;
  await loaded.page.preload(qc, target.searchStr).catch(() => {});
}
