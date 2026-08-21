export const playwrightPort = 5174;
// STAGE_URL points the suite at a deployed Alchemy stage (issue #95) instead of
// the local dev server; playwright.config.ts drops its `webServer` entries when
// it is set, because there is nothing left to start.
export const appUrl = process.env.STAGE_URL ?? `http://localhost:${playwrightPort}`;
export const explorerUrl = `${appUrl}/cdn-cgi/explorer/api`;

// `vite preview` serves the *built* worker and assets, which is the only way
// to exercise the production Content-Security-Policy: `vite dev` relaxes
// script-src to admit the React Refresh preamble Vite injects, so a page that
// works there proves nothing about the policy that actually ships.
export const previewPort = 4174;
export const previewUrl = `http://localhost:${previewPort}`;
