import { TURNSTILE_FAILED_CODE } from "@/shared/types";

type TurnstileRefusal = { code?: string; error?: { code?: string } } | null | undefined;

// better-auth resolves with `{ error }` rather than throwing; api() rejects with an
// ApiError carrying `.code`. Both shapes must be read.
export function isTurnstileFailure<T>(result: T): boolean {
  // SAFETY: this reads two optional fields off whatever arrived. Both shapes
  // are this app's own (an ApiError, and the { error } better-auth resolves
  // with); anything else carries neither field and reads as undefined.
  const refusal = result as TurnstileRefusal;
  return refusal?.code === TURNSTILE_FAILED_CODE || refusal?.error?.code === TURNSTILE_FAILED_CODE;
}

// Retry once, not in a loop: a second refusal is real. The rejection must be caught
// as well as inspected, or a spent token surfaced as a human-check error.
export async function retryOnTurnstileFailure<T>(
  run: (headers: Record<string, string>) => Promise<T>,
  headers: () => Promise<Record<string, string>>,
): Promise<T> {
  try {
    const first = await run(await headers());
    if (!isTurnstileFailure(first)) return first;
  } catch (error) {
    if (!isTurnstileFailure(error)) throw error;
  }
  return run(await headers());
}
