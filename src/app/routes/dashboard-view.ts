export type DashboardView = "userLoading" | "noOrg" | "statsLoading" | "statsError" | "ready";

export function dashboardView(
  userLoading: boolean,
  hasOrg: boolean,
  statsLoading: boolean,
  hasStats: boolean,
): DashboardView {
  if (userLoading) return "userLoading";
  if (!hasOrg) return "noOrg";
  if (statsLoading) return "statsLoading";
  if (!hasStats) return "statsError";
  return "ready";
}
