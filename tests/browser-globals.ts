/**
 * The browser globals bun's test runner does not provide. There is no DOM, so a
 * test installs just enough of each to answer what the code under test asks.
 */
export interface BrowserGlobals {
  window?: {
    location?: { origin?: string; search?: string; hostname?: string; href?: string };
    history?: { state: null; replaceState: (state: null, unused: string, url: string) => void };
  };
  document?: { referrer?: string };
  localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

// SAFETY: the global object is extensible, and nothing else in the run
// declares these three names, so writing them adds properties rather than
// changing the type of anything that already exists.
const globals = globalThis as BrowserGlobals;

export function installBrowserGlobals(values: BrowserGlobals): void {
  Object.assign(globals, values);
}

export function removeBrowserGlobals(...names: (keyof BrowserGlobals)[]): void {
  for (const name of names) delete globals[name];
}
