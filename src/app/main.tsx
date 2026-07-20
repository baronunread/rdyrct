import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";
import { ToastProvider } from "./ui/toast";
import { ConsentBanner } from "./ui/consent-banner";
import { LandingPage } from "./routes/landing";
import { AuthPage } from "./routes/auth";
import { ResetPasswordPage } from "./routes/reset-password";
import { InvitePage } from "./routes/invite";
import { PrivacyPage } from "./routes/privacy";
import { TermsPage } from "./routes/terms";
import { AppShell, RequireAuth, RequireAdmin } from "./routes/shell";
import { Dashboard } from "./routes/dashboard";
import { LinksPage } from "./routes/links";
import { MembersPage } from "./routes/members";
import { BillingPage } from "./routes/billing";
import { DomainsPage } from "./routes/domains";
import { SettingsPage } from "./routes/settings";
import { AdminOverviewPage } from "./routes/admin/overview";
import { AdminOrgsPage } from "./routes/admin/orgs";
import { AdminUsersPage } from "./routes/admin/users";
import { NotFound } from "./routes/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
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
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
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
          <ConsentBanner />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
