export const playwrightPort = 5174;
export const appUrl = `http://localhost:${playwrightPort}`;
export const explorerUrl = `${appUrl}/cdn-cgi/explorer/api`;

// SHARED_LINK_HOST in .dev.vars.playwright: the host a new shared-domain
// link is shown and copied on, distinct from appUrl (the app's own origin).
export const sharedLinkHost = "rdyr.cc";

// `vite preview` serves the *built* worker and assets, which is the only way
// to exercise the production Content-Security-Policy: `vite dev` relaxes
// script-src to admit the React Refresh preamble Vite injects, so a page that
// works there proves nothing about the policy that actually ships.
export const previewPort = 4174;
export const previewUrl = `http://localhost:${previewPort}`;

// A self-hosted build (VITE_RDYRCT_SITE=0), served the same way as the
// preview above: see playwright.self-host.config.ts.
export const selfHostPort = 4184;
export const selfHostUrl = `http://localhost:${selfHostPort}`;

/**
 * The build-time values every browser run uses, whatever the developer's own
 * `.env` says (Vite prefers the process environment). The project token is
 * .env.build.example's placeholder, so the analytics path runs and nothing
 * reaches a real project; the dev token keeps localhost out of both.
 */
export const BUILD_ENV = {
  PLAYWRIGHT_TEST: "1",
  VITE_RDYRCT_SITE: "1",
  VITE_PUBLIC_POSTHOG_PROJECT_TOKEN: "your_posthog_project_token",
  VITE_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
  VITE_PUBLIC_POSTHOG_DEV_PROJECT_TOKEN: "phc_e2e",
};
