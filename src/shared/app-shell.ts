/** App pages a reload paints from a prerendered shell (scripts/prerender-app-shell.tsx, served by serveSpa). Admin is left out: its own skeleton covers it. */
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

/** A single link (/links/<slug>) shares one file: its skeleton does not depend on the slug. */
export function appShellPage(pathname: string): AppShellPage | null {
  if (/^\/links\/[^/]+$/.test(pathname)) return "link";
  return BY_PATH.get(pathname) ?? null;
}
