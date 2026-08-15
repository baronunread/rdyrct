/**
 * What to put in front of a person when a request failed.
 *
 * The server's own message when there is one: it says what was actually
 * wrong, which a generic line cannot. Anything thrown that is not an Error
 * carries nothing worth reading, so it gets the fallback.
 */
export function errorMessage(cause: unknown, fallback = "Something went wrong"): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
