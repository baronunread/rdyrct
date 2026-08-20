import { StrictMode, Suspense, lazy, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  RouterProvider,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "./styles.css";
import { ToastProvider } from "./ui/toast";
import { ErrorBoundary } from "./components/error-boundary";
import { ConsentBanner } from "./ui/consent-banner";
import { AppShellSkeleton } from "./components/skeletons";
import { LandingHeader } from "./components/landing-header";
import { readAuthHint } from "./lib/user-cache";
import { resumeAnalyticsIfConsented } from "./lib/posthog";

resumeAnalyticsIfConsented();

// Every route loads lazily so the entry chunk stays small: visitors on the
// marketing landing never download the app, and the app never downloads the
// admin pages unless the user is the platform admin.
const LandingPage = lazy(() =>
  import("./routes/landing").then((m) => ({ default: m.LandingPage })),
);
const AuthPage = lazy(() => import("./routes/auth").then((m) => ({ default: m.AuthPage })));
const ResetPasswordPage = lazy(() =>
  import("./routes/reset-password").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);
const InvitePage = lazy(() => import("./routes/invite").then((m) => ({ default: m.InvitePage })));
const PrivacyPage = lazy(() =>
  import("./routes/privacy").then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazy(() => import("./routes/terms").then((m) => ({ default: m.TermsPage })));
const QrGeneratorPage = lazy(() =>
  import("./routes/qr-generator").then((m) => ({ default: m.QrGeneratorPage })),
);
const PricingPage = lazy(() =>
  import("./routes/pricing").then((m) => ({ default: m.PricingPage })),
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
const NotFound = lazy(() => import("./routes/not-found").then((m) => ({ default: m.NotFound })));

/**
 * The marketing pages that carry the landing header, and the header itself
 * while their chunk downloads.
 *
 * It rides in the entry chunk (a few hundred bytes) rather than waiting for
 * the page's, so somebody arriving here sees the site's header on the first
 * frame and the page fills in under it, instead of watching an empty screen
 * with a cookie banner on it. Same wrapper as every page in the group uses,
 * so nothing moves when the real one takes over.
 *
 * The card pages (login, signup, invite) are deliberately not in here: they
 * have no header, and showing one would be a flash of the wrong thing.
 *
 * A navigation between these pages runs as a view transition (see the
 * viewTransition Links in landing-header.tsx, footer.tsx and elsewhere): a
 * fresh document load always starts at the top, but a client-side route
 * change keeps wherever the old page had scrolled to, so leaving mid-FAQ on
 * "/" and clicking Pricing landed mid-table on "/pricing" instead of at its
 * top. A hash still gets to choose its own landing spot (see
 * useScrollToHash, called by the page that owns the target section, since
 * it needs that section to exist first); this only resets the rest.
 *
 * useLayoutEffect, not useEffect: the router settles its view transition's
 * "after" snapshot from its own useLayoutEffect (Transitioner.tsx), and the
 * browser captures that snapshot as soon as this commit's layout effects are
 * done, before a later paint. A passive effect runs after that capture, so
 * the reset would show up as a second, separate jump once the crossfade had
 * already finished; a layout effect lands inside the same commit the
 * transition is watching, so the scroll and the content change as one move.
 *
 * `behavior: "instant"`, not the two-argument form: styles.css turns on
 * `scroll-behavior: smooth` site-wide, which `window.scrollTo(x, y)` inherits
 * (it's shorthand for `behavior: "auto"`, and "auto" means "whatever the
 * CSSOM says"). An inherited smooth scroll still had distance left to cover
 * once the transition's snapshot was already taken, so the crossfade landed
 * on the new page and then visibly crept the rest of the way to the top.
 * "instant" is the one value smooth scroll-behavior can't override.
 */
function PublicPages() {
  const { pathname, hash } = useLocation();
  useLayoutEffect(() => {
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash]);

  return (
    <Suspense
      fallback={
        <div className="relative mx-auto min-h-dvh max-w-5xl px-6">
          <LandingHeader authed={readAuthHint()} />
        </div>
      }
    >
      <Outlet />
    </Suspense>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    // The card pages get a blank fallback; the two header pages and the app
    // shell branch below bring their own. The consent banner sits inside the
    // boundary so it waits for the page it belongs to: on its own over an
    // empty screen it read as the whole site.
    <Suspense fallback={null}>
      <Outlet />
      <ConsentBanner />
    </Suspense>
  ),
  notFoundComponent: NotFound,
});

// Pathless layout: adds the marketing header/scroll-reset wrapper without an
// extra URL segment.
const publicLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "public-layout",
  component: PublicPages,
});

const landingRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/",
  component: LandingPage,
});
const qrGeneratorRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/qr-code-generator",
  component: QrGeneratorPage,
});
const pricingRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/pricing",
  component: PricingPage,
});
const privacyRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/privacy",
  component: PrivacyPage,
});
const termsRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: "/terms",
  component: TermsPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: () => <AuthPage mode="login" />,
});
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  component: () => <AuthPage mode="signup" />,
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

// One guard for the whole section, and one place for its sub-navigation.
// Four separate RequireAdmin routes was four chances to forget one, and one
// of them already had been (#67).
const adminRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/admin",
  component: () => (
    <RequireAdmin>
      <AdminLayout />
    </RequireAdmin>
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
  publicLayoutRoute.addChildren([
    landingRoute,
    qrGeneratorRoute,
    pricingRoute,
    privacyRoute,
    termsRoute,
  ]),
  loginRoute,
  signupRoute,
  resetPasswordRoute,
  inviteRoute,
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
    adminRoute.addChildren([
      adminUsageRoute,
      adminLinksRoute,
      adminOrgsRoute,
      adminUsersRoute,
      adminAuditRoute,
    ]),
  ]),
]);

const router = createRouter({ routeTree, defaultPreload: false });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ErrorBoundary>
          <RouterProvider router={router} />
        </ErrorBoundary>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
