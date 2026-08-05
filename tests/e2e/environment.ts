export const playwrightPort = 5174;
export const appUrl = `http://localhost:${playwrightPort}`;
export const explorerUrl = `${appUrl}/cdn-cgi/explorer/api`;

// `vite preview` serves the *built* worker and assets, which is the only way
// to exercise the production Content-Security-Policy: `vite dev` relaxes
// script-src to admit the React Refresh preamble Vite injects, so a page that
// works there proves nothing about the policy that actually ships.
export const previewPort = 4174;
export const previewUrl = `http://localhost:${previewPort}`;
