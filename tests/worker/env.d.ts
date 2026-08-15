// `env` from cloudflare:workers is typed as Cloudflare.Env, which wrangler
// normally generates into a 15k-line worker-configuration.d.ts. We already
// hand-write that shape in src/worker/env.ts, so point the ambient type at it
// instead of committing generated runtime types: the binding a test reads is
// then the same type the worker under test receives.
import type { D1Migration } from "cloudflare:test";
import type { Env as WorkerEnv } from "../../src/worker/env";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      /** vitest.config.ts reads the migrations off disk and binds them here. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
