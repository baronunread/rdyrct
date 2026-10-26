import { createLoggerStorage } from "evlog/toolkit/storage";
import type { JsonValue } from "../shared/types";

// Its own module, free of `cloudflare:workers`, so code the Bun unit tests
// load (rate-limit.ts) can report through it.

/** The store the Hono middleware runs each API request in (evlog shares a
 * store by id). `asWideEvent` runs background work in it too, so
 * `logFailure` finds whichever event is active. */
export const { storage: activeLog } = createLoggerStorage("wide event", "evlog:hono");

/** Context for a failure: plain values, never a raw body. */
type Fields = { [key: string]: JsonValue };

/**
 * A failure the caller recovers from. On the active wide event (an API
 * request, a cron run, a queue batch) it is a warning, which the sampling
 * always keeps, listed under `failures` so a run with several keeps them
 * all. Outside one (a Durable Object, a redirect's waitUntil) it goes to the
 * console, as before.
 */
export function logFailure(message: string, cause?: unknown, fields?: Fields): void {
  const log = activeLog.getStore();
  if (!log) {
    console.error(message, fields ?? "", cause ?? "");
    return;
  }
  const error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause ?? "");
  log.warn(message);
  log.set({ failures: [{ message, error, ...fields }] });
}
