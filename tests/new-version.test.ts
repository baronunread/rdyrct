/**
 * The stale-chunk recovery rule: when a lazy route chunk 404s after a deploy,
 * the error boundary forces one reload onto the current build, latched per
 * failure. If the same chunk is still missing after that (a genuinely broken
 * deploy), it stops reloading so the tab doesn't loop and falls through to the
 * notice; the next deploy, with new chunk names, gets its own retry.
 *
 * `vite dev` masks this in the browser: its own error overlay catches the
 * failed dynamic import before React does, so an e2e can't see the boundary.
 * This tests the guard, which is the whole of the new logic.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { reloadForNewVersion } from "../src/app/lib/new-version";

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

test("reloads once per failure, then refuses so the tab can't loop", () => {
  expect(reloadForNewVersion(A)).toBe(true);
  expect(reloads).toBe(1);

  // Same failure, chunk still missing: no second reload, caller falls back.
  expect(reloadForNewVersion(A)).toBe(false);
  expect(reloads).toBe(1);
});

test("a different missing chunk gets its own reload", () => {
  reloadForNewVersion(A);
  expect(reloadForNewVersion(B)).toBe(true);
  expect(reloads).toBe(2);
});

test("refuses when TanStack Router already reloaded for this failure", () => {
  store.set(`tanstack_router_reload:${A}`, "1");
  expect(reloadForNewVersion(A)).toBe(false);
  expect(reloads).toBe(0);
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

  // No way to latch the reload, so an unguarded one could loop: fall back.
  expect(reloadForNewVersion(A)).toBe(false);
  expect(reloads).toBe(0);
});
