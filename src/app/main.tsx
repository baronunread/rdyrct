import { StrictMode, Suspense, lazy } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
  lazyRouteComponent,
} from "@tanstack/react-router";
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
import { AppShellSkeleton, AdminPlatformSkeleton } from "./components/skeletons";
import { marketingRoutes } from "./marketing-routes";
import { rootRoute } from "./root-route";
import { resumeAnalyticsIfConsented } from "./lib/posthog";
import { PRERENDERED_PUBLIC_PATHS } from "@/shared/page-meta";
import { RDYRCT_SITE } from "@/shared/site";

// Every route loads lazily so the entry chunk stays small: visitors on the
// marketing landing never download the app, and the app never downloads the
// admin pages unless the user is the platform admin.
// Router-managed lazy components can preload before navigation commits.
const LoginPage = lazyRouteComponent(() => import("./routes/auth"), "LoginPage");
const SignupPage = lazyRouteComponent(() => import("./routes/auth"), "SignupPage");
const ResetPasswordPage = lazy(() =>
  import("./routes/reset-password").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);
const InvitePage = lazy(() => import("./routes/invite").then((m) => ({ default: m.InvitePage })));
const ConsentPage = lazy(() =>
  import("./routes/consent").then((m) => ({ default: m.ConsentPage })),
);
const AppShell = lazy(() => import("./routes/shell").then((m) => ({ default: m.AppShell })));
const RequireAuth = lazy(() => import("./routes/shell").then((m) => ({ default: m.RequireAuth })));
const RequireAdmin = lazy(() =>
  import("./routes/shell").then((m) => ({ default: m.RequireAdmin })),
);
const Dashboard = lazy(() => import("./routes/dashboard").then((m) => ({ default: m.Dashboard })));
const Analytics = lazy(() => import("./routes/analytics").then((m) => ({ default: m.Analytics })));
const LinksPage = lazy(() => import("./routes/links").then((m) => ({ default: m.LinksPage })));
const LinkDetailPage = lazy(() =>
  import("./routes/link-detail").then((m) => ({ default: m.LinkDetailPage })),
);
const MembersPage = lazy(() =>
  import("./routes/members").then((m) => ({ default: m.MembersPage })),
);
const BillingPage = lazy(() =>
  import("./routes/billing").then((m) => ({ default: m.BillingPage })),
);
const DomainsPage = lazy(() =>
  import("./routes/domains").then((m) => ({ default: m.DomainsPage })),
);
const SettingsPage = lazy(() =>
  import("./routes/settings").then((m) => ({ default: m.SettingsPage })),
);
const ApiKeysPage = lazy(() =>
  import("./routes/api-keys").then((m) => ({ default: m.ApiKeysPage })),
);
const OrganizationPage = lazy(() =>
  import("./routes/organization").then((m) => ({ default: m.OrganizationPage })),
);
const AdminUsagePage = lazy(() =>
  import("./routes/admin/usage").then((m) => ({
    default: m.AdminUsagePage,
  })),
);
const AdminLayout = lazy(() =>
  import("./routes/admin/layout").then((m) => ({ default: m.AdminLayout })),
);
const AdminAuditPage = lazy(() =>
  import("./routes/admin/audit").then((m) => ({ default: m.AdminAuditPage })),
);
const AdminLinksPage = lazy(() =>
  import("./routes/admin/links").then((m) => ({ default: m.AdminLinksPage })),
);
const AdminOrgsPage = lazy(() =>
  import("./routes/admin/orgs").then((m) => ({ default: m.AdminOrgsPage })),
);
const AdminUsersPage = lazy(() =>
  import("./routes/admin/users").then((m) => ({ default: m.AdminUsersPage })),
);

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

const dashboardRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/dashboard",
  component: Dashboard,
});
const analyticsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/analytics",
  component: Analytics,
});
const linksRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/links",
  component: LinksPage,
});
const linkDetailRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/links/$slug",
  component: LinkDetailPage,
});
const membersRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/members",
  component: MembersPage,
});
const billingRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/billing",
  component: BillingPage,
});
const domainsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/domains",
  component: DomainsPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/settings",
  component: SettingsPage,
});
const apiKeysRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/api-keys",
  component: ApiKeysPage,
});
const organizationRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/organization",
  component: OrganizationPage,
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
const adminUsageRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "/",
  component: AdminUsagePage,
});
const adminLinksRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "links",
  component: AdminLinksPage,
});
const adminOrgsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "orgs",
  component: AdminOrgsPage,
});
const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "users",
  component: AdminUsersPage,
});
const adminAuditRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "audit",
  component: AdminAuditPage,
});

const routeTree = rootRoute.addChildren([
  RDYRCT_SITE ? marketingRoutes() : appHomeRoute,
  loginRoute,
  signupRoute,
  resetPasswordRoute,
  inviteRoute,
  consentRoute,
  onboardingRoute,
  appShellRoute.addChildren([
    dashboardRoute,
    analyticsRoute,
    linksRoute,
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

export const PRERENDER_ROUTES = [...PRERENDERED_PUBLIC_PATHS] as const;

const router = globalThis.window
  ? createRouter({ routeTree, defaultPreload: false })
  : createRouter({
      routeTree,
      defaultPreload: false,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

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

export async function preparePublicPage(path: (typeof PRERENDER_ROUTES)[number]) {
  if (!router.state.matches.length) await router.load();
  await router.preloadRoute({ to: path });
  router.history.push(path);
  await router.load();
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
    createRoot(root).render(<App />);
  }
}
