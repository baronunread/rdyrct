import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Lets code deep inside a request hand work to `ctx.waitUntil` without the
 * ExecutionContext being threaded through every call between them.
 *
 * BetterAuth is why this exists. Its handler is built once per isolate and
 * cached, so the context cannot be baked into it, and its hooks receive a
 * raw Request with no way back to the Worker's ctx. Meanwhile one of those
 * hooks has to send an email that must not be part of the response: awaiting
 * it made a signup for a registered address measurably slower than one for a
 * free address, which is the account probe #53 set out to close.
 */
/** Structural, not the ExecutionContext type: Hono's context and
 * workers-types' disagree on fields nothing here reads. */
interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

const currentCtx = new AsyncLocalStorage<WaitUntil>();

/** Runs `fn` with `ctx` available to `afterResponse` anywhere inside it,
 * across awaits. */
export function withBackground<T>(ctx: WaitUntil, fn: () => T): T {
  return currentCtx.run(ctx, fn);
}

/**
 * Keeps `work` running after the response is sent.
 *
 * Falls back to letting the promise run unattended when there is no context,
 * which only happens if a caller forgot `withBackground`. Rejections are
 * swallowed here: this is work nobody is waiting on, so a throw has no one
 * to reach and would only surface as an unhandled rejection. Callers that
 * care about the failure catch it themselves before handing it over.
 */
export function afterResponse(work: Promise<unknown>): void {
  const settled = work.catch(() => {});
  currentCtx.getStore()?.waitUntil(settled);
}
