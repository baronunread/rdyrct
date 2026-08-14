import type { Env } from "../src/worker/env";

/**
 * An Env holding only the bindings a test names.
 *
 * The unit tests here call one worker function at a time, and each reads a
 * handful of bindings. Naming those and leaving the rest out is what makes the
 * test readable: the bindings listed are the ones the behaviour depends on.
 */
export function partialEnv(bindings: Partial<Env>): Env {
  // SAFETY: the function under test reads only the bindings the caller named.
  // Anything else is absent rather than wrong, and reading it would throw here
  // rather than pass on a stand-in nobody meant.
  return bindings as Env;
}
