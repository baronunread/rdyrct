/**
 * The stale-chunk recovery rule: when a lazy route chunk 404s after a deploy,
 * the error boundary forces a reload onto the current build, counted per
 * failure. A route on `lazyRouteComponent` may already have spent its own
 * single built-in reload before this ever runs, and a first reload can race a
 * deploy that is still landing, so the budget is more than one. If the same
 * chunk is still missing after every attempt (a genuinely broken deploy), it
 * stops reloading so the tab doesn't loop and falls through to the notice;
 * the next deploy, with new chunk names, gets its own budget.
 *
 * `vite dev` masks this in the browser: its own error overlay catches the
 * failed dynamic import before React does, so an e2e can't see the boundary.
 * This tests the guard, which is the whole of the new logic.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  dismissNewVersion,
  forgetBlockedTarget,
  getNewVersion,
  isChunkLoadError,
  reloadForNewVersion,
  reloadNow,
  signalNewVersionAvailable,
} from "../src/app/lib/new-version";

const A = "Failed to fetch dynamically imported module: /assets/links-a1b2c3.js";
const B = "Failed to fetch dynamically imported module: /assets/domains-d4e5f6.js";

let reloads: number;
let store: Map<string, string>;

beforeEach(() => {
  reloads = 0;
  store = new Map();
  Object.assign(globalThis, {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    window: { location: { reload: () => void (reloads += 1) } },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "sessionStorage");
  Reflect.deleteProperty(globalThis, "window");
});

test("reloads a bounded number of times per failure, then refuses so the tab can't loop", () => {
  expect(reloadForNewVersion(A)).toBe(true);
  expect(reloadForNewVersion(A)).toBe(true);
  expect(reloads).toBe(2);

  // Same failure, chunk still missing after every attempt: no more reloads,
  // caller falls back to the notice.
  expect(reloadForNewVersion(A)).toBe(false);
  expect(reloads).toBe(2);
});

test("a different missing chunk gets its own budget", () => {
  reloadForNewVersion(A);
  reloadForNewVersion(A);
  expect(reloadForNewVersion(B)).toBe(true);
  expect(reloads).toBe(3);
});

test("does not defer to a marker TanStack Router left behind; it counts its own attempts", () => {
  store.set(`tanstack_router_reload:${A}`, "1");
  expect(reloadForNewVersion(A)).toBe(true);
  expect(reloads).toBe(1);
});

test("shows the notice instead of reloading when sessionStorage is unavailable", () => {
  Object.assign(globalThis, {
    sessionStorage: {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    },
  });

  // No way to count the attempt, so an unguarded one could loop: fall back.
  expect(reloadForNewVersion(A)).toBe(false);
  expect(reloads).toBe(0);
});

test("recognises a deleted chunk in each engine's wording, as production serves it", () => {
  // A chunk gone after a deploy comes back as the SPA's HTML with a 200.
  // Messages copied from Chromium, Firefox and WebKit importing one.
  const url = "https://rdyrct.com/assets/pricing-CUkH27n3.js";
  for (const message of [
    `Failed to fetch dynamically imported module: ${url}`,
    `error loading dynamically imported module: ${url}`,
    `'text/html' is not a valid JavaScript MIME type for module script '${url}'.`,
    "Importing a module script failed.",
  ])
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  expect(isChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
});

test("a later signal with no page keeps the page a blocked click was opening", () => {
  let assigned = "";
  Object.assign(globalThis.window, { location: { assign: (href: string) => (assigned = href) } });
  signalNewVersionAvailable("/pricing");
  // Vite's preloadError for the same chunk, which Safari fires afterwards.
  signalNewVersionAvailable();
  reloadNow();
  expect(assigned).toBe("/pricing");
  dismissNewVersion();
});

test("a navigation that went through after a blocked one reloads the page on screen", () => {
  let reloaded = false;
  let assigned = "";
  Object.assign(globalThis.window, {
    location: { assign: (href: string) => (assigned = href), reload: () => (reloaded = true) },
  });
  signalNewVersionAvailable("/pricing");
  forgetBlockedTarget();
  reloadNow();
  expect(assigned).toBe("");
  expect(reloaded).toBe(true);
  expect(getNewVersion()).toBe(true);
  dismissNewVersion();
});
