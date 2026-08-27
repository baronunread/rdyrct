import { initLogger } from "evlog";
import { evlog } from "evlog/hono";
import { createSentryDrain } from "evlog/sentry";

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
const INCLUDED = ["/api/**", "/api/*"];

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
