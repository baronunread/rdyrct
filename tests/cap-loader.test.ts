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
    loading ??= load().catch((error: Error) => {
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

/**
 * The two rules that keep a solve from silently producing nothing.
 *
 * Cap's widget resolves `solve()` with `undefined` in two cases, both proven
 * in a browser against the real widget: a second concurrent `solve()` on the
 * same element (it opens with `if (this.#solving) return;`), and an element
 * removed while solving (`disconnectedCallback` aborts, and every `await`
 * inside `solve()` is followed by `if (signal?.aborted) return;`). Neither
 * throws and neither fires an error event, so an undefined result became an
 * empty token, no `x-cap-token` header, and "could not verify you are human"
 * in front of somebody trying to sign up.
 *
 * The lifecycle is DOM-bound, so what is asserted here is the policy around
 * it: callers share one in-flight solve, and a solve that yields no token is
 * retried once on a fresh widget.
 */
function makeSolver(solve: (attempt: number) => Promise<{ token?: string } | null>) {
  let inFlight: Promise<string> | null = null;
  let built = 0;
  const run = () => {
    inFlight ??= (async () => {
      try {
        for (let tries = 0; tries < 2; tries++) {
          built++;
          const result = await solve(built);
          if (result?.token) return result.token;
        }
        return "";
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
  return { run, widgets: () => built };
}

describe("solving a challenge", () => {
  test("two callers at once share one solve rather than racing the widget", async () => {
    const solver = makeSolver(async () => ({ token: "t" }));

    const [a, b] = await Promise.all([solver.run(), solver.run()]);

    expect([a, b]).toEqual(["t", "t"]);
    // The second call must not have started its own: that is the concurrent
    // solve() the widget answers with undefined.
    expect(solver.widgets()).toBe(1);
  });

  test("retries once on a fresh widget when a solve comes back empty", async () => {
    // What an aborted solve looks like from here: no token, no error.
    const solver = makeSolver(async (attempt) => (attempt === 1 ? undefined : { token: "t" }));

    expect(await solver.run()).toBe("t");
    expect(solver.widgets()).toBe(2);
  });

  test("gives up after the second empty solve instead of looping", async () => {
    const solver = makeSolver(async () => undefined);

    expect(await solver.run()).toBe("");
    expect(solver.widgets()).toBe(2);
  });

  test("a later solve starts fresh once the first has settled", async () => {
    const solver = makeSolver(async () => ({ token: "t" }));

    await solver.run();
    await solver.run();

    expect(solver.widgets()).toBe(2);
  });
});
