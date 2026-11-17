export const playwrightPort = 5174;
export const appUrl = `http://localhost:${playwrightPort}`;
export const explorerUrl = `${appUrl}/cdn-cgi/explorer/api`;

export const sharedLinkHost = "rdyr.cc";

// Only the built worker (`vite preview`) has the production CSP: `vite dev`
// relaxes script-src for React Refresh, so a page passing there proves nothing.
export const previewPort = 4174;
export const previewUrl = `http://localhost:${previewPort}`;

export const selfHostPort = 4184;
export const selfHostUrl = `http://localhost:${selfHostPort}`;

// Overrides the developer's `.env` (Vite prefers the process environment). The
// tokens are placeholders: analytics code runs and nothing reaches a real project.
export const BUILD_ENV = {
  PLAYWRIGHT_TEST: "1",
  VITE_RDYRCT_SITE: "1",
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: "your_posthog_project_token",
  VITE_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
  VITE_PUBLIC_POSTHOG_DEV_PROJECT_TOKEN: "phc_e2e",
};
