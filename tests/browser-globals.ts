/**
 * The browser globals bun's test runner does not provide.
 *
 * App code that reads `window`, `document` or `localStorage` is exercised here
 * without a DOM, so a test installs just enough of each to answer what the
 * code under test asks. Each field is only as wide as that: this is a list of
 * what the tests stand in for, not an attempt at a browser.
 */
export interface BrowserGlobals {
  window?: {
    location?: { origin?: string; search?: string; hostname?: string; href?: string };
  };
  document?: { referrer?: string };
  localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

// SAFETY: the global object is extensible, and nothing else in the run
// declares these three names, so writing them adds properties rather than
// changing the type of anything that already exists.
const globals = globalThis as BrowserGlobals;

/** Installs the given globals for the duration of a test. */
export function installBrowserGlobals(values: BrowserGlobals): void {
  Object.assign(globals, values);
}

/** Takes them away again, so the next test starts without a browser. */
export function removeBrowserGlobals(...names: (keyof BrowserGlobals)[]): void {
  for (const name of names) delete globals[name];
}
