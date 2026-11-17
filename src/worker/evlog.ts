import { tracing } from "cloudflare:workers";
import { createLogger, initLogger } from "evlog";
import { evlog } from "evlog/hono";
import { createSentryDrain } from "evlog/sentry";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import type { AppEnv } from "./env";
import { activeLog } from "./log-failure";

// Wide events flow to Sentry as Structured Logs, separate from the Issues withSentry captures. Global, so background events reach it too.
const sentryDrain = createSentryDrain();

initLogger({
  drain: sentryDrain,
  env: { service: "rdyrct" },
  // Head sampling keeps every warn/error and samples the high-volume info logs (redirects, SPA fallback).
  sampling: {
    rates: { info: 10, warn: 100, error: 100 },
    keep: [{ status: 400 }, { status: 500 }],
  },
});

// Only API routes emit: evlog wraps streamed responses to emit after the body drains, which corrupts the SPA HTML (React never mounts).
const INCLUDED = ["/api/**", "/api/*", "/__dev/**", "/unsubscribe"];

export const evlogMiddleware = evlog({
  include: INCLUDED,
  keep: (ctx) => {
    if (ctx.status && ctx.status >= 400) ctx.shouldKeep = true;
  },
});

// Names both by the matched route so one endpoint groups as one; without the ids the Sentry drain invents a trace id per event.
// Register right after evlogMiddleware.
export const evlogRequestContext = createMiddleware<AppEnv>(async (c, next) => {
  // Optional calls although the types say otherwise: the runtime ships these piecemeal (the test pool workerd has tracing without getActiveSpan),
  // and an older runtime has to lose the trace link, not every request.
  const span = tracing.getActiveSpan?.();
  const ids = span?.spanContext?.();
  if (ids) c.get("log")?.set({ traceId: ids.traceId, spanId: ids.spanId });
  await next();
  const route = routePath(c);
  c.get("log")?.set({ route });
  span?.updateName?.(`${c.req.method} ${route}`);
});

interface Operation {
  kind: "cron" | "queue";
  name: string;
  size?: number;
}

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

// Every logFailure inside run lands on it; a throw marks it failed and is rethrown, so withSentry still raises the Issue.
export async function asWideEvent<T>(
  ctx: WaitUntil,
  operation: Operation,
  run: () => Promise<T>,
): Promise<T> {
  const log = createLogger({ operation }, { waitUntil: (p) => ctx.waitUntil(p) });
  const ids = tracing.getActiveSpan?.()?.spanContext?.();
  if (ids) log.set({ traceId: ids.traceId, spanId: ids.spanId });
  try {
    return await activeLog.run(log, run);
  } catch (cause) {
    log.error(cause instanceof Error ? cause : String(cause));
    throw cause;
  } finally {
    log.emit();
  }
}
