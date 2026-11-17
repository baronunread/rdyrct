import type { Env } from "../src/worker/env";

export function partialEnv(bindings: Partial<Env>): Env {
  // SAFETY: the function under test reads only the bindings the caller named.
  // Anything else is absent rather than wrong, and reading it would throw here
  // rather than pass on a stand-in nobody meant.
  return bindings as Env;
}
