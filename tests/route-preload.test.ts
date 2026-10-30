import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { loadAdminPage, loadPage, type PageContext } from "../src/app/lib/route-preload";
import { appPageTransitionTypes } from "../src/app/lib/page-transition";
import type { CurrentUser, UserOrg } from "../src/shared/types";

const org = (id: string): UserOrg =>
  // SAFETY: loadPage reads only `id` off an org; the rest is not under test.
  ({ id, name: id, role: "owner", plan: "pro" }) as UserOrg;

function userWith(orgs: UserOrg[], isAdmin = false): CurrentUser {
  // SAFETY: loadPage reads only `orgs` and `user.isAdmin`.
  return { user: { id: "u1", isAdmin }, orgs } as CurrentUser;
}

/** A client whose user and config are already answered, so nothing fetches. */
function clientWith(user: CurrentUser | null): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData(["user"], user);
  qc.setQueryData(["config"], {});
  return qc;
}

const target = { params: {}, searchStr: "?tab=mcp" };

describe("loadPage", () => {
  test("hands the page the first org, its id and where it is going", async () => {
    const calls: { orgId: string; page: PageContext }[] = [];
    const preload = async (_qc: QueryClient, orgId: string, page: PageContext) => {
      calls.push({ orgId, page });
    };
    await loadPage(clientWith(userWith([org("a"), org("b")])), async () => ({ preload }), target);
    expect(calls).toHaveLength(1);
    expect(calls[0].orgId).toBe("a");
    expect(calls[0].page.searchStr).toBe("?tab=mcp");
  });

  test("asks nothing for somebody signed out or with no org", async () => {
    let called = 0;
    const preload = async () => {
      called++;
    };
    await loadPage(clientWith(null), async () => ({ preload }), target);
    await loadPage(clientWith(userWith([])), async () => ({ preload }), target);
    expect(called).toBe(0);
  });

  test("still preloads the account's own data for somebody with no org", async () => {
    let account = 0;
    let orgPage = 0;
    const page = async () => ({
      preload: async () => {
        orgPage++;
      },
      preloadAccount: async () => {
        account++;
      },
    });
    await loadPage(clientWith(userWith([])), page, target);
    await loadPage(clientWith(null), page, target);
    expect({ account, orgPage }).toEqual({ account: 1, orgPage: 0 });
  });

  test("never fails the navigation", async () => {
    const preload = async () => {
      throw new Error("network down");
    };
    await expect(
      loadPage(clientWith(userWith([org("a")])), async () => ({ preload }), target),
    ).resolves.toBeUndefined();
  });
});

describe("loadAdminPage", () => {
  test("preloads for a platform admin only", async () => {
    const seen: string[] = [];
    const preload = async (_qc: QueryClient, searchStr: string) => {
      seen.push(searchStr);
    };
    await loadAdminPage(clientWith(userWith([], false)), async () => ({ preload }), target);
    await loadAdminPage(clientWith(userWith([], true)), async () => ({ preload }), target);
    expect(seen).toEqual(["?tab=mcp"]);
  });
});

describe("appPageTransitionTypes", () => {
  const at = (pathname: string) => ({ pathname });
  const inApp = (l: { pathname: string }) => l.pathname !== "/login";

  test("crossfades a move from one app page to another", () => {
    expect(
      appPageTransitionTypes(
        { fromLocation: at("/links"), toLocation: at("/members"), pathChanged: true },
        inApp,
      ),
    ).toEqual(["app-page"]);
  });

  test("morphs Links into a link's page and back, and nowhere else", () => {
    const types = (from: string, to: string) =>
      appPageTransitionTypes(
        { fromLocation: at(from), toLocation: at(to), pathChanged: true },
        inApp,
      );
    expect(types("/links", "/links/abc")).toEqual(["app-page", "link-morph"]);
    expect(types("/links/abc", "/links")).toEqual(["app-page", "link-morph"]);
    expect(types("/dashboard", "/links/abc")).toEqual(["app-page"]);
    expect(types("/links/abc", "/links/def")).toEqual(["app-page"]);
  });

  test("holds the Platform header still between its tabs", () => {
    expect(
      appPageTransitionTypes(
        { fromLocation: at("/admin"), toLocation: at("/admin/users"), pathChanged: true },
        inApp,
      ),
    ).toEqual(["app-page", "platform"]);
  });

  test("not a search-only change, a first load, or a move out of the app", () => {
    expect(
      appPageTransitionTypes(
        { fromLocation: at("/links"), toLocation: at("/links"), pathChanged: false },
        inApp,
      ),
    ).toBe(false);
    expect(appPageTransitionTypes({ toLocation: at("/links"), pathChanged: true }, inApp)).toBe(
      false,
    );
    expect(
      appPageTransitionTypes(
        { fromLocation: at("/links"), toLocation: at("/login"), pathChanged: true },
        inApp,
      ),
    ).toBe(false);
  });
});
