// Points Cloudflare.Env at our hand-written Env instead of wrangler's generated
// 15k-line types, so tests read the same type the worker receives.
import type { D1Migration } from "cloudflare:test";
import type { Env as WorkerEnv } from "../../src/worker/env";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
