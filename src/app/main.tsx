import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";
import { ToastProvider } from "./ui/toast";
import { ConsentBanner } from "./ui/consent-banner";
import { AppShellSkeleton } from "./components/skeletons";

// Every route loads lazily so the entry chunk stays small: visitors on the
// marketing landing never download the app, and the app never downloads the
// admin pages unless the user is the platform admin.
const LandingPage = lazy(() =>
  import("./routes/landing").then((m) => ({ default: m.LandingPage })),
);
const AuthPage = lazy(() =>
  import("./routes/auth").then((m) => ({ default: m.AuthPage })),
);
const ResetPasswordPage = lazy(() =>
  import("./routes/reset-password").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);
const InvitePage = lazy(() =>
  import("./routes/invite").then((m) => ({ default: m.InvitePage })),
);
const PrivacyPage = lazy(() =>
  import("./routes/privacy").then((m) => ({ default: m.PrivacyPage })),
);
const TermsPage = lazy(() =>
  import("./routes/terms").then((m) => ({ default: m.TermsPage })),
);
const AppShell = lazy(() =>
  import("./routes/shell").then((m) => ({ default: m.AppShell })),
);
const RequireAuth = lazy(() =>
  import("./routes/shell").then((m) => ({ default: m.RequireAuth })),
);
const RequireAdmin = lazy(() =>
  import("./routes/shell").then((m) => ({ default: m.RequireAdmin })),
);
const Dashboard = lazy(() =>
  import("./routes/dashboard").then((m) => ({ default: m.Dashboard })),
);
const LinksPage = lazy(() =>
  import("./routes/links").then((m) => ({ default: m.LinksPage })),
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
const AdminOverviewPage = lazy(() =>
  import("./routes/admin/overview").then((m) => ({
    default: m.AdminOverviewPage,
  })),
);
const AdminOrgsPage = lazy(() =>
  import("./routes/admin/orgs").then((m) => ({ default: m.AdminOrgsPage })),
);
const AdminUsersPage = lazy(() =>
  import("./routes/admin/users").then((m) => ({ default: m.AdminUsersPage })),
);
const NotFound = lazy(() =>
  import("./routes/not-found").then((m) => ({ default: m.NotFound })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          {/* public pages get a blank fallback; the app shell branch below has
              its own skeleton fallbacks */}
          <Suspense fallback={null}>
            <Routes>
              {/* public */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/signup" element={<AuthPage mode="signup" />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/invite/:token" element={<InvitePage />} />

              {/* onboarding is gone: the app renders a create-org empty state
                  instead; keep stale links working */}
              <Route
                path="/onboarding"
                element={<Navigate to="/dashboard" replace />}
              />

              {/* authenticated app: root keywords, no /app prefix, no org id */}
              <Route
                element={
                  <Suspense fallback={<AppShellSkeleton />}>
                    <RequireAuth>
                      <AppShell />
                    </RequireAuth>
                  </Suspense>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/links" element={<LinksPage />} />
                <Route path="/members" element={<MembersPage />} />
                <Route path="/billing" element={<BillingPage />} />
                <Route path="/domains" element={<DomainsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route
                  path="/admin"
                  element={
                    <RequireAdmin>
                      <AdminOverviewPage />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="/admin/orgs"
                  element={
                    <RequireAdmin>
                      <AdminOrgsPage />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="/admin/users"
                  element={
                    <RequireAdmin>
                      <AdminUsersPage />
                    </RequireAdmin>
                  }
                />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <ConsentBanner />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
