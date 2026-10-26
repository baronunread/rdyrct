import { RDYRCT_SITE, SITE_ONLY_PATHS } from "./site";

/**
 * Every page the SPA's router renders, in TanStack's path syntax: a segment
 * starting with `$` is a parameter and matches any one segment.
 *
 * The Worker answers anything else with a 404, so a mistyped or invented
 * path is a real "not found" for a crawler instead of the landing page's
 * shell under a 200. That makes this list the router's twin: a page added to
 * src/app/main.tsx and not here would 404 on a reload. tests/util.test.ts
 * reads the router's source and fails when the two disagree.
 *
 * rdyrct.com's own pages (SITE_ONLY_PATHS, from marketing-routes.tsx) only
 * count on rdyrct.com; a self-hosted build has none of them.
 */
export const APP_ROUTES: readonly string[] = [
  "/login",
  "/signup",
  "/reset-password",
  "/invite/$token",
  "/consent",
  "/onboarding",
  "/dashboard",
  "/analytics",
  "/links",
  "/links/$slug",
  "/import",
  "/members",
  "/billing",
  "/domains",
  "/settings",
  "/api-keys",
  "/organization",
  "/admin",
  "/admin/links",
  "/admin/orgs",
  "/admin/users",
  "/admin/audit",
];

const SPA_ROUTES = [...APP_ROUTES, ...(RDYRCT_SITE ? SITE_ONLY_PATHS : [])].map((route) =>
  route === "/" ? [] : route.slice(1).split("/"),
);

/**
 * The address a path should be served at, or null when the SPA has no page
 * there.
 *
 * Fixed segments match in any case and come back lowercase (/PRICING is
 * /pricing); parameters come back exactly as given, because slugs and invite
 * tokens are case-sensitive. A path that is already canonical comes back
 * unchanged, so `canonicalSpaPath(p) === p` means "serve it".
 */
export function canonicalSpaPath(pathname: string): string | null {
  const segments = pathname === "/" ? [] : pathname.slice(1).split("/");
  for (const route of SPA_ROUTES) {
    const canonical = matchRoute(route, segments);
    if (canonical) return `/${canonical.join("/")}`;
  }
  return null;
}

/** One route's segments with the path's case fixed, or null if it differs. */
function matchRoute(route: string[], segments: string[]): string[] | null {
  if (route.length !== segments.length) return null;
  const canonical = route.map((part, i) => {
    const segment = segments[i] ?? "";
    if (!segment) return null;
    if (part.startsWith("$")) return segment;
    return part === segment.toLowerCase() ? part : null;
  });
  return canonical.every((part): part is string => part !== null) ? canonical : null;
}
