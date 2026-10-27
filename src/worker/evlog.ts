import { tracing } from "cloudflare:workers";
import { initLogger } from "evlog";
import { evlog } from "evlog/hono";
import { createSentryDrain } from "evlog/sentry";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import type { AppEnv } from "./env";

initLogger({
  env: { service: "rdyrct" },
  // Head sampling: keep every warn/error, but sample the high-volume info
  // logs (redirects, SPA fallback) down so we don't emit one Sentry Log per
  // request at scale. Tail `keep` below still forces 4xx/5xx retention.
  sampling: {
    rates: { info: 10, warn: 100, error: 100 },
    keep: [{ status: 400 }, { status: 500 }],
  },
});

// Wide events (one per request) flow to Sentry as Structured Logs
// (Explore > Logs), separate from the error Issues `withSentry` already
// captures. SENTRY_DSN is read from the environment; unset disables it.
const drains = [createSentryDrain()];

// Only API routes emit wide events. SPA documents and the root slug redirect
// are served by the Worker too, but evlog wraps streamed responses to emit
// after the body drains — which corrupts the SPA HTML the browser receives
// (React never mounts). Scoping emit to /api/** keeps the SPA and the root
// redirect untouched while still covering every handler entry point.
// /__dev only exists in a dev build (src/worker/dev-scenarios.ts).
const INCLUDED = ["/api/**", "/api/*", "/__dev/**"];

/** Register once, before your routes: `app.use(evlogMiddleware)`. */
export const evlogMiddleware = evlog({
  drain: async (ctx) => {
    await Promise.all(drains.map((drain) => drain(ctx)));
  },
  include: INCLUDED,
  keep: (ctx) => {
    if (ctx.status && ctx.status >= 400) ctx.shouldKeep = true;
  },
});

/**
 * Ties each wide event to Cloudflare's trace of the same request, and names
 * both by the matched route (`/api/orgs/:orgId/links`) rather than the URL,
 * so one endpoint groups as one in Sentry and in Workers Observability.
 * Without the ids the Sentry drain invents a random trace id per event.
 * Register right after `evlogMiddleware`.
 */
export const evlogRequestContext = createMiddleware<AppEnv>(async (c, next) => {
  // Optional calls although the types say otherwise: the runtime ships these
  // piecemeal (spanContext and updateName arrived 2026-10-26, and the test
  // pool's workerd has `tracing` without getActiveSpan), and an older runtime
  // has to lose the trace link, not every request.
  const span = tracing.getActiveSpan?.();
  const ids = span?.spanContext?.();
  if (ids) c.get("log")?.set({ traceId: ids.traceId, spanId: ids.spanId });
  await next();
  const route = routePath(c);
  c.get("log")?.set({ route });
  span?.updateName?.(`${c.req.method} ${route}`);
});
