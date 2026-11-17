import { AsyncLocalStorage } from "node:async_hooks";

/**
 * BetterAuth's handler is built once per isolate, and its hooks get a raw Request,
 * so they cannot reach ctx.waitUntil. One hook sends an email that must not be
 * part of the response: awaiting it made signup slower for a registered address (#53).
 */
/** Structural: Hono's context and workers-types' disagree on fields nothing here reads. */
interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

const currentCtx = new AsyncLocalStorage<WaitUntil>();

export function withBackground<T>(ctx: WaitUntil, fn: () => T): T {
  return currentCtx.run(ctx, fn);
}

/**
 * Rejections are swallowed: nobody waits on this work, so a throw would only
 * become an unhandled rejection. Callers that care catch it first.
 */
export function afterResponse(work: Promise<unknown>): void {
  const settled = work.catch(() => {});
  currentCtx.getStore()?.waitUntil(settled);
}
