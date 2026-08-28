/**
 * The stale-chunk recovery rule: when a lazy route chunk 404s after a deploy,
 * the error boundary forces exactly one reload onto the current build. If the
 * chunk is still missing after that (a genuinely broken deploy), it must stop
 * reloading so the tab doesn't loop, and fall through to the notice instead.
 *
 * `vite dev` masks this in the browser: its own error overlay catches the
 * failed dynamic import before React does, so an e2e can't see the boundary.
 * This tests the guard, which is the whole of the new logic.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { reloadForNewVersion } from "../src/app/lib/new-version";

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

test("reloads once, then refuses so the tab can't loop", () => {
  expect(reloadForNewVersion()).toBe(true);
  expect(reloads).toBe(1);

  // Same session, chunk still missing: no second reload, caller told to fall back.
  expect(reloadForNewVersion()).toBe(false);
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

  // No way to remember a reload happened, so an unguarded reload could loop:
  // fall back to the notice.
  expect(reloadForNewVersion()).toBe(false);
  expect(reloads).toBe(0);
});
