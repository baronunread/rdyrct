import { describe, expect, test } from "bun:test";

/**
 * The widget loader's caching rule, which is the whole bug this file exists
 * for: a load that fails must not be remembered.
 *
 * `loading ??= makePromise()` kept whatever the first attempt settled to. One
 * bad fetch (a dev server restarting under an open tab, a chunk that 404s
 * after a deploy, a dropped connection) therefore poisoned every later solve
 * in that tab: the form said "could not verify you are human" on every
 * attempt from then on, and nothing but a reload cleared it.
 *
 * The loader itself imports the widget and a WASM asset, so this tests the
 * caching rule against the same shape rather than the module: bun's test
 * runner cannot resolve `?url` asset imports.
 */
function makeLoader(load: () => Promise<void>) {
  let loading: Promise<void> | null = null;
  return () => {
    loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
}

describe("loading the proof-of-work widget", () => {
  test("loads once and reuses it", async () => {
    let calls = 0;
    const loadCap = makeLoader(async () => {
      calls++;
    });

    await loadCap();
    await loadCap();
    await loadCap();

    expect(calls).toBe(1);
  });

  test("tries again after a failure instead of failing forever", async () => {
    let calls = 0;
    const loadCap = makeLoader(async () => {
      calls++;
      if (calls === 1) throw new Error("chunk 404");
    });

    await expect(loadCap()).rejects.toThrow("chunk 404");
    // The attempt that used to inherit the first one's failure for the life
    // of the tab.
    await loadCap();

    expect(calls).toBe(2);
  });

  test("goes back to reusing one load once it succeeds", async () => {
    let calls = 0;
    const loadCap = makeLoader(async () => {
      calls++;
      if (calls === 1) throw new Error("offline");
    });

    await expect(loadCap()).rejects.toThrow("offline");
    await loadCap();
    await loadCap();

    expect(calls).toBe(2);
  });
});
