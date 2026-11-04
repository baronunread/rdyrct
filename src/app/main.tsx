import { StrictMode, Suspense, lazy } from "react";
// The shell through one loader, so a sign-in that fetched it ahead of time
// (routes/auth.tsx) draws it at once instead of its skeleton.
import {
  loadShell,
  AppShellPart as AppShell,
  RequireAdminPart as RequireAdmin,
  RequireAuthPart as RequireAuth,
} from "./lib/shell-loader";
import { loadWelcome, WelcomePagePart } from "./lib/welcome-loader";
import { appNavItems } from "./components/nav-items";
import { createRoot, hydrateRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
  type ParsedLocation,
} from "@tanstack/react-router";
import { guardStaleChunks, lazyPage } from "./lib/chunk-guard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// Figtree carries everything anybody reads; JetBrains Mono is kept for
// identifiers, the strings a person copies or types. See the rdyrct-design
// skill for which is which.
//
// The variable cut, not four static weights: one 20KB file covers 300 to 900
// against 48KB for the four, and it is one module in the entry graph instead
// of four. That last part is why it changed: on a cold dev server in CI the
// extra transforms pushed the landing page's first paint past a 5s
// expectation. `wght.css` carries latin and latin-ext behind unicode-range,
// so only the subset a page needs is fetched.
import "./styles.css";
import { ToastProvider } from "./ui/toast";
import { ErrorBoundary } from "./components/error-boundary";
import { NewVersionBanner } from "./components/new-version-banner";
import {
  AppShellSkeleton,
  AdminPlatformSkeleton,
  AdminSectionSkeleton,
  RouteSkeleton,
} from "./components/skeletons";
import { appPageTransitionTypes } from "./lib/page-transition";
import {
  loadAdminPage,
  loadPage,
  type AdminPagePreload,
  type PagePreload,
} from "./lib/route-preload";
import { marketingRoutes } from "./marketing-routes";
import { rootRoute } from "./root-route";
import { resumeAnalyticsIfConsented } from "./lib/posthog";
import { PRERENDERED_PUBLIC_PATHS } from "@/shared/page-meta";
import { RDYRCT_SITE } from "@/shared/site";

// Every route loads lazily so the entry chunk stays small: visitors on the
// marketing landing never download the app, and the app never downloads the
// admin pages unless the user is the platform admin.
// Router-managed lazy components can preload before navigation commits.
const LoginPage = lazyPage(() => import("./routes/auth"), "LoginPage");
const SignupPage = lazyPage(() => import("./routes/auth"), "SignupPage");
// React.lazy pages: named imports, so the stale-chunk guard can ask for them
// too (guardStaleChunks below).
const resetPassword = () => import("./routes/reset-password");
const invite = () => import("./routes/invite");
const consent = () => import("./routes/consent");
const ResetPasswordPage = lazy(() =>
  resetPassword().then((m) => ({ default: m.ResetPasswordPage })),
);
const InvitePage = lazy(() => invite().then((m) => ({ default: m.InvitePage })));
const ConsentPage = lazy(() => consent().then((m) => ({ default: m.ConsentPage })));

// The app's pages are router-managed (lazyPage, lib/chunk-guard.ts) rather than
// React.lazy: the router fetches a page's chunk and its data (the loaders
// below) before it swaps pages, so the page you are on stays until the next
// one can draw whole. See lib/route-preload.ts.
const dashboard = () => import("./routes/dashboard");
const analytics = () => import("./routes/analytics");
const links = () => import("./routes/links");
const linkImport = () => import("./routes/link-import");
const linkImportPreload = () => import("./routes/link-import-preload");
const linkDetail = () => import("./routes/link-detail");
const members = () => import("./routes/members");
const billing = () => import("./routes/billing");
const domains = () => import("./routes/domains");
const settings = () => import("./routes/settings");
const apiKeys = () => import("./routes/api-keys");
const organization = () => import("./routes/organization");
const adminUsage = () => import("./routes/admin/usage");
const adminLinks = () => import("./routes/admin/links");
const adminOrgs = () => import("./routes/admin/orgs");
const adminUsers = () => import("./routes/admin/users");
const adminAudit = () => import("./routes/admin/audit");
const adminLayout = () => import("./routes/admin/layout");
const AdminLayout = lazy(() => adminLayout().then((m) => ({ default: m.AdminLayout })));

// A self-hosted copy has no landing page: its front door is the app, which
// sends anybody signed out on to /login.
const appHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  component: SignupPage,
});
const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: ResetPasswordPage,
});
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: InvitePage,
});
const consentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/consent",
  component: ConsentPage,
});

// Between a pricing link (or Polar) and the app: routes/welcome.tsx. Signed
// in, but outside the shell, so its card can become the org switcher.
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome",
  // Loaded before the route commits (lib/welcome-loader.ts), so the sign-in
  // card hands over to the page itself and never to a fallback. Only its
  // own code: it checks sign-in itself, so a full page load (back from
  // Google or Polar) draws the card without waiting for the app shell.
  loader: () => loadWelcome(),
  component: () => (
    <Suspense fallback={null}>
      <WelcomePagePart />
    </Suspense>
  ),
});

// onboarding is gone: the app renders a create-org empty state instead;
// keep stale links working
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});

// authenticated app: root keywords, no /app prefix, no org id
const appShellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app-shell",
  component: () => (
    <Suspense fallback={<AppShellSkeleton />}>
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    </Suspense>
  ),
});

/** Where a page is going, as a loader hears it. */
interface LoaderArgs {
  params: Record<string, string>;
  location: { searchStr: string };
}

/**
 * A page's loader: its chunk and the data its first frame reads.
 *
 * Only awaited once the app is on screen. A cold load returns at once and
 * lets the fetches run alongside the first render, so the shell and the
 * page's own skeleton paint as soon as the chunk is in, as they always did,
 * instead of a blank screen waiting on the network.
 */
const pageLoader =
  (importPage: () => Promise<{ preload: PagePreload }>) =>
  ({ params, location }: LoaderArgs): Promise<void> | undefined => {
    const work = loadPage(queryClient, importPage, { params, searchStr: location.searchStr });
    return router.state.resolvedLocation ? work : undefined;
  };

const adminLoader =
  (importPage: () => Promise<{ preload: AdminPagePreload }>) =>
  ({ params, location }: LoaderArgs): Promise<void> | undefined => {
    const work = loadAdminPage(queryClient, importPage, { params, searchStr: location.searchStr });
    return router.state.resolvedLocation ? work : undefined;
  };

// A slow page (pendingMs) shows the skeleton of the page it is opening, in
// the sheet, and keeps it long enough to read as a step (pendingMinMs)
// rather than a flash. A fast one never shows it.
const appPage = {
  getParentRoute: () => appShellRoute,
  pendingComponent: RouteSkeleton,
};

const dashboardRoute = createRoute({
  ...appPage,
  path: "/dashboard",
  component: lazyPage(dashboard, "Dashboard"),
  loader: pageLoader(dashboard),
});
const analyticsRoute = createRoute({
  ...appPage,
  path: "/analytics",
  component: lazyPage(analytics, "Analytics"),
  loader: pageLoader(analytics),
});
const linksRoute = createRoute({
  ...appPage,
  path: "/links",
  component: lazyPage(links, "LinksPage"),
  loader: pageLoader(links),
});
const linkDetailRoute = createRoute({
  ...appPage,
  path: "/links/$slug",
  component: lazyPage(linkDetail, "LinkDetailPage"),
  loader: pageLoader(linkDetail),
});
const linkImportRoute = createRoute({
  ...appPage,
  path: "/import",
  component: lazyPage(linkImport, "LinkImportPage"),
  loader: pageLoader(linkImportPreload),
});
const membersRoute = createRoute({
  ...appPage,
  path: "/members",
  component: lazyPage(members, "MembersPage"),
  loader: pageLoader(members),
});
const billingRoute = createRoute({
  ...appPage,
  path: "/billing",
  component: lazyPage(billing, "BillingPage"),
  loader: pageLoader(billing),
});
const domainsRoute = createRoute({
  ...appPage,
  path: "/domains",
  component: lazyPage(domains, "DomainsPage"),
  loader: pageLoader(domains),
});
const settingsRoute = createRoute({
  ...appPage,
  path: "/settings",
  component: lazyPage(settings, "SettingsPage"),
  loader: pageLoader(settings),
});
const apiKeysRoute = createRoute({
  ...appPage,
  path: "/api-keys",
  component: lazyPage(apiKeys, "ApiKeysPage"),
  loader: pageLoader(apiKeys),
});
const organizationRoute = createRoute({
  ...appPage,
  path: "/organization",
  component: lazyPage(organization, "OrganizationPage"),
  loader: pageLoader(organization),
});

// One guard for the whole section, and one place for its sub-navigation.
// Four separate RequireAdmin routes was four chances to forget one, and one
// of them already had been (#67).
const adminRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/admin",
  component: () => (
    <Suspense fallback={<AdminPlatformSkeleton />}>
      <RequireAdmin>
        <AdminLayout />
      </RequireAdmin>
    </Suspense>
  ),
});
// Inside the Platform frame, so a slow tab holds the frame and draws only
// the section's own skeleton under it.
const adminPage = {
  getParentRoute: () => adminRoute,
  pendingComponent: AdminSectionSkeleton,
};
const adminUsageRoute = createRoute({
  ...adminPage,
  path: "/",
  component: lazyPage(adminUsage, "AdminUsagePage"),
  loader: adminLoader(adminUsage),
});
const adminLinksRoute = createRoute({
  ...adminPage,
  path: "links",
  component: lazyPage(adminLinks, "AdminLinksPage"),
  loader: adminLoader(adminLinks),
});
const adminOrgsRoute = createRoute({
  ...adminPage,
  path: "orgs",
  component: lazyPage(adminOrgs, "AdminOrgsPage"),
  loader: adminLoader(adminOrgs),
});
const adminUsersRoute = createRoute({
  ...adminPage,
  path: "users",
  component: lazyPage(adminUsers, "AdminUsersPage"),
  loader: adminLoader(adminUsers),
});
const adminAuditRoute = createRoute({
  ...adminPage,
  path: "audit",
  component: lazyPage(adminAudit, "AdminAuditPage"),
  loader: adminLoader(adminAudit),
});

const routeTree = rootRoute.addChildren([
  RDYRCT_SITE ? marketingRoutes() : appHomeRoute,
  loginRoute,
  signupRoute,
  resetPasswordRoute,
  inviteRoute,
  consentRoute,
  onboardingRoute,
  welcomeRoute,
  appShellRoute.addChildren([
    dashboardRoute,
    analyticsRoute,
    linksRoute,
    linkImportRoute,
    linkDetailRoute,
    membersRoute,
    billingRoute,
    domainsRoute,
    settingsRoute,
    apiKeysRoute,
    organizationRoute,
    adminRoute.addChildren([
      adminUsageRoute,
      adminLinksRoute,
      adminOrgsRoute,
      adminUsersRoute,
      adminAuditRoute,
    ]),
  ]),
]);

// react-doctor-disable-next-line react-doctor/only-export-components -- the entry module, not a component file: scripts/prerender-public.tsx imports these to render each public page.
export const PRERENDER_ROUTES = [...PRERENDERED_PUBLIC_PATHS] as const;

// Before the router: the page loaders fill this cache.
//
// 30 seconds fresh, so going back to a page you just left draws it from the
// cache without asking again. A mutation still refetches what it changes
// (invalidateQueries ignores staleTime).
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

/**
 * Moving between app pages crossfades the page inside the sheet and nothing
 * else (the `app-page` rules in styles.css). Only when the path changes: a
 * range, a tab or a filter is the same page and swaps in place. Browsers
 * that cannot scope a view transition by type get none, rather than a
 * whole-window fade on every filter change.
 */
const APP_PAGE_TRANSITION = globalThis.CSS?.supports?.("selector(:active-view-transition-type(a))")
  ? { types: (change: ViewTransitionChange) => appPageTransitionTypes(change, inApp) }
  : false;

interface ViewTransitionChange {
  fromLocation?: ParsedLocation;
  toLocation: ParsedLocation;
  pathChanged: boolean;
}

function inApp(location: ParsedLocation): boolean {
  return router.matchRoutes(location).some((match) => match.routeId === appShellRoute.id);
}

const router = globalThis.window
  ? createRouter({
      routeTree,
      // Hovering or focusing a link fetches the page behind it, chunk and
      // data, so the click usually finds it ready.
      defaultPreload: "intent",
      defaultPreloadDelay: 50,
      // TanStack Query decides what is fresh; the router just asks it.
      defaultPreloadStaleTime: 0,
      defaultPendingMs: 400,
      defaultPendingMinMs: 350,
      defaultViewTransition: APP_PAGE_TRANSITION,
      // On a desktop the app scrolls inside its sheet, not the window
      // (shellLayout), so a new page has to start that at the top too.
      scrollToTopSelectors: ["window", "[data-app-sheet]"],
    })
  : createRouter({
      routeTree,
      defaultPreload: false,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });

// A click into a page whose code is gone (a tab older than the last deploy)
// stays where it is and offers a reload, instead of a blank screen.
if (globalThis.window)
  guardStaleChunks(router, {
    [appShellRoute.id]: loadShell,
    [welcomeRoute.id]: loadWelcome,
    [adminRoute.id]: adminLayout,
    [resetPasswordRoute.id]: resetPassword,
    [inviteRoute.id]: invite,
    [consentRoute.id]: consent,
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ErrorBoundary>
            <RouterProvider router={router} />
          </ErrorBoundary>
          {/* Outside the boundary: it stays mounted when a chunk failure crashes
            the app underneath, so the "new version available" prompt survives. */}
          <NewVersionBanner />
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

// react-doctor-disable-next-line react-doctor/only-export-components -- read by scripts/prerender-public.tsx, as PRERENDER_ROUTES is.
export async function preparePublicPage(path: (typeof PRERENDER_ROUTES)[number]) {
  if (!router.state.matches.length) await router.load();
  await router.preloadRoute({ to: path });
  router.history.push(path);
  await router.load();
}

/**
 * A reload of an app page by somebody signed in (index.html's head script
 * sets data-auth from the cached /user) starts fetching the shell's chunk
 * now, alongside this one, rather than when React first asks for it. The
 * first render does not wait: the skeleton it paints draws the sidebar from
 * the same cache, identical to the shell that replaces it, so the page is
 * there at once and the swap moves nothing.
 */
const SHELL_ROOTS = [...appNavItems.map((item) => item.to), "/import", "/admin"];

function prefetchShell() {
  const { pathname } = globalThis.location;
  const inApp = SHELL_ROOTS.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  if (globalThis.document.documentElement.dataset.auth === "in" && inApp)
    loadShell().catch(() => {});
}

/**
 * The prerendered shell stays on screen until React has drawn its own. React
 * empties its container on the first commit, before the router has drawn
 * anything, which showed as a one-frame blank between the two. So the static
 * copy steps out of #root first, and goes the moment React puts anything in
 * it: a MutationObserver runs before the browser paints, so the two never
 * show together and nothing is ever missing.
 */
function handOverStaticShell(root: HTMLElement) {
  const shell = root.querySelector("[data-shell-static]");
  if (!shell) return;
  root.before(shell);
  const done = () => {
    watch.disconnect();
    shell.remove();
  };
  const watch = new MutationObserver(() => {
    if (root.childElementCount > 0) done();
  });
  watch.observe(root, { childList: true });
  // Whatever happens, it does not outstay a page that never drew.
  setTimeout(done, 10_000);
}

const HYDRATE_WAIT_MS = 3000;
const root = globalThis.document?.getElementById("root") ?? null;
if (globalThis.document) globalThis.document.documentElement.dataset.motionReady = "true";
if (root) {
  resumeAnalyticsIfConsented();
  if (root.dataset.prerendered === globalThis.window.location.pathname) {
    // Hydrating before the route's lazy chunk has arrived renders its
    // pending component over the prerendered page: the text vanishes and
    // pops back in. Load the route first, so hydration finds what the server
    // sent and the page stays as painted. A failed or hung load (a stalled
    // chunk request) still hydrates, after HYDRATE_WAIT_MS.
    //
    // And the router must know the HTML came from a server render. It leaves
    // out the root Suspense boundary for server HTML (as the prerender did);
    // without this the client adds one, React finds a tree that differs from
    // the HTML (error #418) and throws the prerendered DOM away.
    router.ssr = { manifest: undefined };
    Promise.race([router.load(), new Promise((resolve) => setTimeout(resolve, HYDRATE_WAIT_MS))])
      .catch(() => {})
      .then(() => hydrateRoot(root, <App />));
  } else {
    prefetchShell();
    handOverStaticShell(root);
    createRoot(root).render(<App />);
  }
}
