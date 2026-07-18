import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";
import { ToastProvider } from "./ui/toast";
import { AuthPage } from "./routes/auth";
import { InvitePage } from "./routes/invite";
import { AppShell, RequireAuth, AppIndex } from "./routes/shell";
import { Dashboard } from "./routes/dashboard";
import { LinksPage } from "./routes/links";
import { MembersPage } from "./routes/members";
import { SettingsPage } from "./routes/settings";
import { AdminOverviewPage, AdminOrgsPage, AdminUsersPage } from "./routes/admin";
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
            <Route path="/" element={<Navigate to="/app" replace />} />
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/signup" element={<AuthPage mode="signup" />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route
              path="/app"
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<AppIndex />} />
              <Route path="admin" element={<AdminOverviewPage />} />
              <Route path="admin/orgs" element={<AdminOrgsPage />} />
              <Route path="admin/users" element={<AdminUsersPage />} />
              <Route path=":orgId" element={<Dashboard />} />
              <Route path=":orgId/links" element={<LinksPage />} />
              <Route path=":orgId/members" element={<MembersPage />} />
              <Route path=":orgId/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
