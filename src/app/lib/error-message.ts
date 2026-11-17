export function errorMessage(cause: unknown, fallback = "Something went wrong"): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
