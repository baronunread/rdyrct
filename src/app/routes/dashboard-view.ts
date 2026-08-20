export type DashboardView = "userLoading" | "noOrg" | "statsLoading" | "statsError" | "ready";

/** Which of the dashboard's five states applies, in the order they resolve:
 * who's signed in, then their org, then that org's numbers. Pulled out of
 * the component so the branching is a plain function fallow can score (and
 * test) on its own, away from JSX. */
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
