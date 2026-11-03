/**
 * The app pages a reload paints from a prerendered shell: the sidebar and
 * the page's own skeleton as HTML, before any JavaScript runs.
 *
 * scripts/prerender-app-shell.tsx renders one file per entry at build
 * (dist/client/_app-shell/<name>.txt) with that page lit and its skeleton
 * under it, and the Worker answers a reload of the page with it instead of
 * the empty shell (src/worker/index.ts, serveSpa). The admin area is left
 * out: it is one person's, and its own skeleton covers it.
 */
export const APP_SHELL_PAGES = {
  dashboard: "/dashboard",
  analytics: "/analytics",
  links: "/links",
  link: "/links/_",
  import: "/import",
  members: "/members",
  domains: "/domains",
  billing: "/billing",
  settings: "/settings",
  organization: "/organization",
  "api-keys": "/api-keys",
} as const;

export type AppShellPage = keyof typeof APP_SHELL_PAGES;

const BY_PATH = new Map<string, AppShellPage>(
  // SAFETY: Object.entries of APP_SHELL_PAGES yields exactly its own keys.
  Object.entries(APP_SHELL_PAGES).map(([name, path]) => [path, name as AppShellPage]),
);

/** Which prerendered shell a path is answered with, or null for none. A
 *  single link (/links/<slug>) shares one file: its skeleton does not
 *  depend on the slug. */
export function appShellPage(pathname: string): AppShellPage | null {
  if (/^\/links\/[^/]+$/.test(pathname)) return "link";
  return BY_PATH.get(pathname) ?? null;
}
