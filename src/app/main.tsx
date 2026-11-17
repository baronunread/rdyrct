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
// The variable cut, not four static weights: one module in the entry graph instead of four.
// On a cold dev server in CI the extra transforms pushed the landing page's first paint past
// a 5s expectation. `wght.css` serves latin and latin-ext behind unicode-range.
import "./styles.css";
import { ToastProvider } from "./ui/toast";
import { ErrorBoundary, RouteError } from "./components/error-boundary";
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

// Every route loads lazily so the entry chunk stays small: marketing visitors never download
// the app, and the app never downloads the admin pages unless the user is the platform admin.
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

// The app's pages are router-managed (lazyPage, lib/chunk-guard.ts) rather than React.lazy:
// the router fetches a page's chunk and data before it swaps pages, so the page you are on
// stays until the next one can draw whole.
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
const adminNewsletter = () => import("./routes/admin/newsletter");
const adminLayout = () => import("./routes/admin/layout");
const AdminLayout = lazy(() => adminLayout().then((m) => ({ default: m.AdminLayout })));

// A self-hosted copy has no landing page: its front door is the app.
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

// Signed in, but outside the shell, so its card can become the org switcher.
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome",
  // Loaded before the route commits (lib/welcome-loader.ts), so the sign-in card hands over
  // to the page itself and never to a fallback. It checks sign-in itself, so a full page load
  // (back from Google or Polar) draws the card without the app shell.
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

interface LoaderArgs {
  params: Record<string, string>;
  location: { searchStr: string };
}

// Only awaited once the app is on screen. A cold load returns at once and lets the fetches
// run alongside the first render, so the shell and skeleton paint as soon as the chunk is in.
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

// A slow page (pendingMs) shows the skeleton of the page it is opening and keeps it long
// enough to read as a step (pendingMinMs). A fast one never shows it.
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

// One guard for the whole section: four separate RequireAdmin routes was four
// chances to forget one, and one of them already had been (#67).
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
const adminNewsletterRoute = createRoute({
  ...adminPage,
  path: "newsletter",
  component: lazyPage(adminNewsletter, "AdminNewsletterPage"),
  loader: adminLoader(adminNewsletter),
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
      adminNewsletterRoute,
    ]),
  ]),
]);

// react-doctor-disable-next-line react-doctor/only-export-components -- the entry module, not a component file: scripts/prerender-public.tsx imports these to render each public page.
export const PRERENDER_ROUTES = [...PRERENDERED_PUBLIC_PATHS] as const;

// 30 seconds fresh, so going back to a page you just left draws from the cache.
// A mutation still refetches what it changes (invalidateQueries ignores staleTime).
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

// Only when the path changes: a range, tab or filter is the same page and swaps in place.
// Browsers that cannot scope a view transition by type get none, rather than a
// whole-window fade on every filter change.
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
      defaultPreload: "intent",
      defaultPreloadDelay: 50,
      defaultPreloadStaleTime: 0,
      defaultPendingMs: 400,
      defaultPendingMinMs: 350,
      defaultViewTransition: APP_PAGE_TRANSITION,
      // A route's error gets the same handling as ErrorBoundary (a stale tab
      // reloads), not the router's own error text.
      defaultErrorComponent: RouteError,
      // On a desktop the app scrolls inside its sheet, not the window
      // (shellLayout), so a new page has to start that at the top too.
      scrollToTopSelectors: ["window", "[data-app-sheet]"],
    })
  : createRouter({
      routeTree,
      defaultPreload: false,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });

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

// The first render does not wait: the skeleton it paints draws the sidebar from the same cache,
// identical to the shell that replaces it, so the swap moves nothing.
const SHELL_ROOTS = [...appNavItems.map((item) => item.to), "/import", "/admin"];

function prefetchShell() {
  const { pathname } = globalThis.location;
  const inApp = SHELL_ROOTS.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  if (globalThis.document.documentElement.dataset.auth === "in" && inApp)
    loadShell().catch(() => {});
}

// React empties its container on the first commit, before the router has drawn anything, which
// showed as a one-frame blank. So the static copy steps out of #root once React puts anything
// in it: a MutationObserver runs before paint, so the two never show together.
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
    // Hydrating before the route's lazy chunk arrives renders its pending component over the
    // prerendered page, so load it first (a hung load still hydrates after HYDRATE_WAIT_MS).
    // The router must know the HTML was server-rendered, or React hits error #418 and drops the DOM.
    router.ssr = { manifest: undefined };
    void Promise.race([
      router.load(),
      new Promise((resolve) => setTimeout(resolve, HYDRATE_WAIT_MS)),
    ])
      .catch(() => {})
      .then(() => hydrateRoot(root, <App />));
  } else {
    prefetchShell();
    handOverStaticShell(root);
    createRoot(root).render(<App />);
  }
}
