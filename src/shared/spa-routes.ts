import { RDYRCT_SITE, SITE_ONLY_PATHS } from "./site";

/** Twin of the router in src/app/main.tsx: a page missing here would 404 on reload (tests/util.test.ts
 * checks). The Worker 404s anything else, so a crawler gets a real "not found". `$` segments are parameters. */
export const APP_ROUTES: readonly string[] = [
  "/login",
  "/signup",
  "/reset-password",
  "/invite/$token",
  "/consent",
  "/onboarding",
  "/welcome",
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
  "/admin/newsletter",
];

const SPA_ROUTES = [...APP_ROUTES, ...(RDYRCT_SITE ? SITE_ONLY_PATHS : [])].map((route) =>
  route === "/" ? [] : route.slice(1).split("/"),
);

/** Fixed segments match in any case and come back lowercase; parameters keep their case, since slugs
 * and invite tokens are case-sensitive. */
export function canonicalSpaPath(pathname: string): string | null {
  const segments = pathname === "/" ? [] : pathname.slice(1).split("/");
  for (const route of SPA_ROUTES) {
    const canonical = matchRoute(route, segments);
    if (canonical) return `/${canonical.join("/")}`;
  }
  return null;
}

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
