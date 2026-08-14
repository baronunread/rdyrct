/**
 * The one rule that decides whether a Cap-guarded request gets a second go.
 *
 * Its own module so it can be tested: cap.ts imports the WASM solver as a
 * `?url` asset, which bun's test runner cannot resolve.
 */
import { CAP_FAILED_CODE } from "@/shared/types";

/**
 * Whether a refusal is the Worker turning down a Cap token.
 *
 * Two shapes reach here, and both have to be read. better-auth resolves with
 * `{ error }` on the object rather than throwing; api() rejects with an
 * ApiError carrying `.code`. Reading only the first is what made the retry
 * below dead code for every api() caller.
 */
export function isCapFailure(result: unknown): boolean {
  const value = result as { code?: string; error?: { code?: string } } | null;
  return value?.code === CAP_FAILED_CODE || value?.error?.code === CAP_FAILED_CODE;
}

/**
 * Runs a Cap-guarded request, and if the Worker refuses the token, solves a
 * fresh one and runs it exactly once more.
 *
 * A token can be refused for reasons the browser cannot see coming: it
 * expired, it was already spent, or the server forgot it. None of those are
 * the visitor's doing and none of them are worth an error message, so proving
 * ourselves again is the honest response. Once, not in a loop: a second
 * refusal means something is actually wrong, and that one belongs on screen.
 *
 * The refusal has to be caught as well as inspected. A rejected promise never
 * reached the check, so a spent token surfaced as "could not verify you are
 * human" in front of somebody who had done nothing wrong, on the one path
 * where retrying always would have worked.
 */
export async function retryOnCapFailure<T>(
  run: (headers: Record<string, string>) => Promise<T>,
  headers: () => Promise<Record<string, string>>,
): Promise<T> {
  try {
    const first = await run(await headers());
    if (!isCapFailure(first)) return first;
  } catch (error) {
    if (!isCapFailure(error)) throw error;
  }
  return run(await headers());
}
