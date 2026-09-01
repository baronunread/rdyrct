import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import type { JsonValue } from "../shared/types";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { methodNotAllowed } from "hono/method-not-allowed";
import { trimTrailingSlash } from "hono/trailing-slash";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, Env } from "./env";
import { withSession } from "./session";
import { getAuth } from "./better-auth";
import { withBackground } from "./background";
import { userRoutes } from "./routes/auth";
import {
  orgRoutes,
  inviteRoutes,
  sweepExpiredInvites,
  sweepStalledOrgDeletions,
} from "./routes/orgs";
import { linkRoutes } from "./routes/links";
import { qrLogoRoutes } from "./routes/qr-logos";
import { avatarRoutes } from "./routes/avatars";
import { adminRoutes } from "./routes/admin";
import { billingRoutes, handlePolarWebhook } from "./routes/billing";
import { domainRoutes } from "./routes/domains";
import { capRoutes } from "./routes/cap";
import { revalidateOnRedirect } from "./risk";
import { evlogMiddleware } from "./evlog";
import { sweepGraceWarnings } from "./reconcile";
import { shortenRoutes, sweepExpiredAnonLinks } from "./routes/shorten";
import { resolveSlug, resolveDomain, domainServing, type KVLink } from "./kv";
import { RESERVED_SLUGS } from "./util";
import { markdownPage, withPageMeta } from "./page-meta";
import { enforcePublicAuthRateLimit, enforceSignedApiRateLimit } from "./rate-limit";
import { applySecurityHeaders } from "./security-headers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import {
  consumeStorageBatch,
  drainStorageOutbox,
  logDeadLetterBatch,
  sweepExpiredAliases,
  sweepOrphanQrLogos,
  type StorageMessage,
} from "./storage";

import {
  enqueueClick,
  consumeClickBatch,
  logClickDeadLetterBatch,
  sweepDedupeIds,
  type ClickMessage,
} from "./clicks";

export { OrgDeleteWorkflow, DomainActivateWorkflow } from "./workflows";

/**
 * The JSON body every API error answers with: a message, plus whatever the
 * route attached to the exception it threw.
 */
interface ErrorBody {
  message: string;
  [field: string]: JsonValue;
}

/**
 * The extra fields a route put on an HTTPException, ready to merge into the
 * error body. A route attaches an object (a machine-readable `code`,
 * same_destination_match's matched link); anything else carries nothing.
 */
function causeFields(cause: unknown): Record<string, JsonValue> {
  // SAFETY: the only writers are this repo's own routes, which attach a
  // plain JSON object; the check above is what keeps anything else out.
  return cause instanceof Object && !Array.isArray(cause)
    ? (cause as Record<string, JsonValue>)
    : {};
}

const app = new Hono<AppEnv>();

// One wide event per request: accumulates context via c.get('log').set() in
// every handler and emits once the response completes. Emit is scoped to /api/**
// inside the middleware (see src/worker/evlog.ts) so the SPA HTML fallback and
// the root slug redirect are never wrapped/drained. The middleware still runs
// for every route, attaching `log`; non-API handlers guard with `?.` since
// evlog skips (and does not attach) filtered-out routes.
app.use(evlogMiddleware);

app.onError((err, c) => {
  // JSON errors always: the SPA's api() reads res.json().message and spreads
  // the rest of the body onto ApiError.data, so a route's `cause` can carry
  // more than just a machine-readable `code` (e.g. same_destination_match's
  // matchedLinkId/matchedLink) straight through to the caller.
  const respond = (body: ErrorBody, status: ContentfulStatusCode) =>
    applySecurityHeaders(c.json(body, status));
  // Attach the error to the wide event so it reaches Sentry Logs with the
  // request context already accumulated. withSentry still captures the
  // exception as a Sentry Issue for alerting.
  c.get("log")?.error(err);
  if (err instanceof HTTPException) {
    return respond({ message: err.message, ...causeFields(err.cause) }, err.status);
  }
  Sentry.captureException(err);
  return respond({ message: "Internal error" }, 500);
});

// Applies the security header baseline to every non-error response this
// Worker sends (see security-headers.ts): registered first, so it wraps
// every handler below (custom-domain redirects, the API, shared-domain slug
// redirects, the SPA asset fallback).
//
// Assigning c.res, not mutating it: applySecurityHeaders returns a copy
// because some responses (ASSETS, Response.redirect) refuse header writes.
// Returning the response from here would not work — after next() the
// context is finalized, and hono's compose only adopts a returned response
// while it isn't.
app.use("*", async (c, next) => {
  await next();
  c.res = applySecurityHeaders(c.res);
});

/* ---------------- redirect hot path ---------------- */

// Click recording happens after the redirect is already on its way
// (waitUntil): the request enqueues an event and returns rather than
// touching D1 itself. See clicks.ts.
function redirectWithClick(c: Context<AppEnv>, hit: KVLink): Response {
  // An anonymous link (Direction A of #96) has no org and no links row, so
  // there is nothing for a click to belong to and no owner who could ever
  // read it. Skipping the write is also the honest version of the pitch:
  // analytics is what signing up buys.
  if (hit.orgId) c.executionCtx.waitUntil(enqueueClick(c, hit));
  // Re-check the destination if its verdict has gone stale (#68). After the
  // redirect is sent, so it costs the person clicking nothing, and only for
  // hosts nobody has checked in the last day.
  c.executionCtx.waitUntil(revalidateOnRedirect(c.env, hit));
  return c.redirect(hit.url, 302);
}

// A temporary alias past its expiry stops resolving the instant it's asked
// for, with no D1 read: the sweep in scheduled() retires the row and clears
// the KV key later, but this check is what actually enforces the deadline.
// `== null` (not `===`) on purpose: a KV value written before this field
// existed has it `undefined`, which must mean "never expires" too.
function isLive(hit: KVLink): boolean {
  return hit.expiresAt == null || hit.expiresAt > Date.now();
}

// Custom domains (Cloudflare for SaaS) are redirect-only: no API, no SPA.
// Hosts we don't know (e.g. *.workers.dev previews) fall through to the app.
app.use("*", async (c, next) => {
  const host = c.req.header("host")?.toLowerCase();
  if (!host || host === c.env.APP_HOST.toLowerCase()) return next();
  const domain = await resolveDomain(c.env, host);
  if (!domain) return next();
  // A locked domain past its 30 days stops resolving, with no D1 read: the
  // deadline is in the value (#159). A 404 rather than a page explaining the
  // downgrade, because most of what reaches a dead short link is a machine,
  // and an honest 404 is the answer a machine can act on.
  if (!domainServing(domain)) return c.text("Not found", 404);

  const path = new URL(c.req.url).pathname;
  // This middleware is a dead end for a host it owns: it never calls next(),
  // so trimTrailingSlash below never gets a turn at a custom domain's own
  // path. A trailing slash has to be stripped right here or "/abc/" reads as
  // a miss and falls all the way through to the domain's root redirect.
  const slug = path.slice(1).replace(/\/+$/, "");
  if (slug && !slug.includes("/")) {
    const hit = await resolveSlug(c.env, slug, host);
    if (hit && isLive(hit)) return redirectWithClick(c, hit);
  }
  // root and misses land on the org's configured root redirect
  if (domain.rootRedirect) return c.redirect(domain.rootRedirect, 302);
  return c.text("Not found", 404);
});

// A trailing slash on a GET (`/abc/`) fell through the shared-domain slug
// route below (hono's `/:slug` param match is exact, no trailing segment)
// straight to the SPA shell under a 200. Custom domains handle their own
// trailing slash above; this covers everything on the shared host.
app.use("*", trimTrailingSlash({ alwaysRedirect: true }));

/* ---------------- API ---------------- */

// A request to a path this app serves under a different method used to fall
// through to the SPA and come back as HTML, so a caller who sent the wrong
// verb read a page instead of an answer. This turns those into 405 with an
// Allow header. It only rewrites a 404, so it never touches a route that
// answered; the custom-domain middleware above returns before this runs, and
// the SPA's app.all("*") is registered for every method, so the middleware
// skips it when collecting what a path allows.
app.use(
  methodNotAllowed<AppEnv>({
    app,
    onMethodNotAllowed: (c, methods) =>
      c.json({ message: "Method not allowed" }, 405, { Allow: methods.join(", ") }),
  }),
);

// BetterAuth owns /api/auth/* (signup, login, logout, verify, reset).
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const log = c.get("log");
  log.set({ route: "/api/auth/*", method: c.req.method });
  log.audit({
    action: "auth.proxy",
    actor: { type: "user", id: c.get("user")?.id ?? "anonymous" },
    outcome: "success",
  });
  const limited = await enforcePublicAuthRateLimit(c);
  if (limited) return limited;
  // withBackground so an auth hook can send mail after the response instead
  // of inside it: the signup guard's timing must not depend on whether the
  // address exists (#53).
  return withBackground(c.executionCtx, () => getAuth(c.env).handler(c.req.raw));
});

// Cap (#98): public, and necessarily so, since it guards signup itself.
// Same public rate limit as the auth routes it protects.
app.post("/api/cap/*", async (c, next) => {
  const log = c.get("log");
  log.set({ route: c.req.path });
  const limited = await enforcePublicAuthRateLimit(c);
  return limited ?? next();
});
app.route("/api/cap", capRoutes);

// The landing page's anonymous shortener (Direction A of #96): public by
// definition, and gated by Cap plus its own rate-limit namespace rather than
// by a session.
app.route("/api/shorten", shortenRoutes);

// Polar webhook: public, signature-verified, no session middleware.
app.post("/api/webhooks/polar", (c) => {
  const log = c.get("log");
  log.set({ route: c.req.path });
  return handlePolarWebhook(c.req.raw, c.env);
});

const api = new Hono<AppEnv>();
api.use("*", withSession);
api.use("*", enforceSignedApiRateLimit);
// Carry the signed-in user onto the wide event once the session is resolved.
// Enrich before `await next()` so a short-circuited response (e.g. a 429 from
// the rate-limit guard) still retains the user context on the wide event.
api.use("*", async (c, next) => {
  const user = c.get("user");
  if (user) c.get("log")?.set({ user: { id: user.id, plan: user.plan } });
  await next();
});
api.route("/", userRoutes);
api.route("/orgs", orgRoutes);
api.route("/orgs/:orgId/links", linkRoutes);
api.route("/orgs/:orgId/qr-logo", qrLogoRoutes);
api.route("/user/avatar", avatarRoutes);
api.route("/billing", billingRoutes);
api.route("/orgs/:orgId/domains", domainRoutes);
api.route("/invites", inviteRoutes);
api.route("/admin", adminRoutes);
app.route("/api", api);

// Everything below serves the SPA to whatever it doesn't recognise, which for
// an API path means an HTML page under a 200. A caller who mistyped a route
// gets an answer it can read instead, and the 405 middleware above has a 404
// to convert when the path exists under another method.
app.all("/api/*", (c) => {
  // `log` is absent for a bare `/api`: Hono's `/api/*` matches it but evlog's
  // include globs (`/api/**`, `/api/*`) don't, so no wide event is attached.
  c.get("log")?.set({ route: c.req.path });
  return c.json({ message: "Not found" }, 404);
});

/* ---------------- SPA fallback ---------------- */

// The SPA is one document for every route, so the head it ships describes the
// landing page. Public pages get their own title, description and canonical
// written in before the bytes leave (#96): a crawler or a link preview reads
// those, and most of them never run the JavaScript that would otherwise set
// them.
//
// `status` overrides what the ASSETS binding returns, which for an unmatched
// path is the SPA shell under a 200 (not_found_handling is
// single-page-application). The SPA renders the same NotFound route either
// way; the status is what a crawler reads.
//
// Only the shell can carry it. Single-segment paths reach here by the same
// door as a dead slug, and some of them are real files (/@react-refresh in
// dev, where React mounts through it): they arrive as themselves, not as
// HTML, and 404ing them took the theme bootstrap down with them.
//
// The known static files never get this far: /assets/* and the root files
// listed beside it are excluded from run_worker_first (wrangler.jsonc), so
// Cloudflare serves them directly and public/_headers carries their
// cache-control and security headers instead.

/**
 * A 404 nothing will cache.
 *
 * The shell arrives carrying the asset server's ETag and `must-revalidate`.
 * Copied onto a 404 those were poison: the browser stored it, sent
 * `If-None-Match` on the next visit, and got back a 304 with no body, so the
 * second visit to any dead short link rendered a blank page instead of the
 * NotFound screen.
 */
function uncacheable404(body: BodyInit | null, from?: Headers): Response {
  const headers = new Headers(from);
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return new Response(body, { status: 404, headers });
}

/**
 * For any unhashed static file that still reaches serveSpa. The known ones
 * are excluded from run_worker_first and cached by public/_headers instead;
 * this hour covers whatever root file somebody adds tomorrow without
 * updating that list. It is short enough that a deploy lands the same
 * session.
 */
const STATIC_CACHE = "public, max-age=3600, must-revalidate";

/**
 * Order matters here, and both branches have taken the app down once.
 *
 * `status` asks for a 404, and only the shell may become one. /:slug routes
 * every single-segment path through here, so the rest are real files — in
 * dev /@react-refresh, which is how React mounts. Check the shell before
 * the status, never after.
 *
 * STATIC_CACHE is production-only. In dev this same fallback serves every
 * source module, and caching those leaves the browser running the code you
 * just edited.
 */
async function serveSpa(c: Context<AppEnv>, status?: 404): Promise<Response> {
  const url = new URL(c.req.url);
  // Markdown is a representation of the same public page, not another route.
  // Select it before fetching the SPA shell, which has no useful body for an
  // agent that does not run JavaScript.
  if (!status && c.req.method === "GET") {
    const markdown = markdownPage(url, c.req.header("accept"));
    if (markdown) return markdown;
  }
  const response = withPageMeta(await c.env.ASSETS.fetch(c.req.raw), url);

  // A conditional request comes back 304 with a null body, and rewriting one
  // of those into a 404 ships an empty document.
  if (response.status !== 200) return response;

  if (!response.headers.get("content-type")?.includes("text/html")) {
    if (import.meta.env.DEV) return response;
    // ASSETS hands back immutable headers, so this has to be a copy.
    const cached = new Response(response.body, response);
    cached.headers.set("cache-control", STATIC_CACHE);
    return cached;
  }
  if (!status) return response;
  return uncacheable404(response.body, response.headers);
}

/* ---------------- shared-domain slug redirect ---------------- */

// Keep the old agent-facing address working, but generate it from the same
// source as negotiated /pricing so those two documents cannot drift apart.
app.get("/pricing.md", (c) => {
  c.get("log")?.set({ route: c.req.path });
  const canonicalUrl = new URL(c.req.url);
  canonicalUrl.pathname = "/pricing";
  // If the pricing entry ever loses its markdown source, say so at the .md
  // address instead of quietly serving the SPA shell there.
  return (
    markdownPage(canonicalUrl, "text/markdown") ??
    new Response("The pricing page has no Markdown source.", { status: 404 })
  );
});

app.get("/:slug", async (c, next) => {
  const slug = c.req.param("slug");
  c.get("log")?.set({ slug });
  // Root keywords the SPA owns (/dashboard, /links, /login, …) never resolve as
  // slugs; they can't be created as slugs either, this is belt-and-suspenders.
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return next();
  const hit = await resolveSlug(c.env, slug, null);
  if (hit && isLive(hit)) return redirectWithClick(c, hit);
  // A slug nobody registered, or one that has expired, is not a page. This
  // used to fall through to the SPA under a 200, so every mistyped or retired
  // short link was a soft 404 that canonicalled to the landing page, and a
  // crawler had no way to tell them apart from real ones.
  return serveSpa(c, 404);
});

app.all("*", (c) => {
  c.get("log")?.set({ route: c.req.path });
  return serveSpa(c);
});

/* ---------------- Queue consumer: KV/R2 follow-up work + click ingestion ---------------- */

// Typed explicitly rather than exported straight off withSentry(): its
// generic return type collapses fetch/queue/scheduled to optional when TS
// can't confirm the handler literal satisfies its constraint, which then
// makes every test file's `worker.fetch(...)` a possibly-undefined call.
type WorkerHandler = {
  fetch: typeof app.fetch;
  queue: ExportedHandlerQueueHandler<Env, StorageMessage | ClickMessage>;
  scheduled: ExportedHandlerScheduledHandler<Env>;
};

const wrapped = Sentry.withSentry<Env, StorageMessage | ClickMessage>(
  (env: Env) => ({ dsn: env.SENTRY_DSN }),
  {
    fetch: app.fetch,
    async queue(
      batch: MessageBatch<StorageMessage | ClickMessage>,
      env: Env,
      _ctx: ExecutionContext,
    ) {
      // Every queue's dead-letter consumer routes to this same handler (see
      // wrangler.jsonc); a DLQ's messages only get logged, never retried or
      // repaired. Check "-clicks-dlq" ahead of the generic "-dlq" suffix, since
      // it ends with both.
      // SAFETY: wrangler.jsonc binds each queue name to the consumer for its
      // own message type, so the suffix that picks the branch is also what
      // decides which of the two bodies the batch holds.
      const clicks = batch as MessageBatch<ClickMessage>;
      // SAFETY: as above, the queue name decides which body the batch holds.
      const storage = batch as MessageBatch<StorageMessage>;
      if (batch.queue.endsWith("-clicks-dlq")) return logClickDeadLetterBatch(clicks);
      if (batch.queue.endsWith("-clicks")) return consumeClickBatch(env, clicks);
      if (batch.queue.endsWith("-dlq")) return logDeadLetterBatch(env, storage);
      await consumeStorageBatch(env, storage);
    },
    async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
      // Daily: trim old clicks.
      const cutoff = Date.now() - 400 * 24 * 60 * 60 * 1000;
      // Bounded batches: one unbounded DELETE can hit D1 statement limits once
      // the table is large.
      const stmt = env.DB.prepare(
        `delete from clicks where id in (select id from clicks where ts < ? limit 1000)`,
      );
      let changes = 0;
      do {
        changes = (await stmt.bind(cutoff).run()).meta.changes;
      } while (changes > 0);

      // Daily: drop dedupe ids the queue can no longer redeliver, so a unique
      // index over 400 days of history stops carrying a guarantee that only
      // has to hold for minutes (#70).
      await sweepDedupeIds(env);

      // Daily: delete QR logos no row points at, which an abandoned upload
      // leaves behind with no owner and no delete path (#49).
      await sweepOrphanQrLogos(env);

      // Daily: restart org teardowns that are flagged and not running (#52).
      // createBatch skips an id already in use whatever its state, so a
      // workflow that errored is never replaced by a later DELETE, and an org
      // whose only member was the deleted account has nobody to retry it.
      await sweepStalledOrgDeletions(drizzle(env.DB, { schema }), env);

      // Daily: apply the storage work the queue never took (#118). A failed
      // send or an exhausted retry leaves KV serving a stale value with
      // nothing scheduled to fix it; this is that schedule.
      await drainStorageOutbox(env);

      // Daily: retire rename aliases past their 48h deadline (see #38). The
      // redirect path already stopped resolving them; this frees their slugs.
      await sweepExpiredAliases(env, drizzle(env.DB, { schema }));

      // Daily: drop invites nobody opened before they expired (#103). An
      // accepted one is already deleted at accept time; this clears the rest,
      // so no token and no invited address outlives the week it was good for.
      await sweepExpiredInvites(env);

      // Daily: drop anonymous links nobody claimed inside their 24 hours, and
      // the KV keys they were resolving through (Direction A of #96).
      await sweepExpiredAnonLinks(env);

      // Daily: the day-23 email for every org whose 30 days are nearly up
      // (#158). Day 0 goes out from the reconciliation pass itself.
      await sweepGraceWarnings(env, drizzle(env.DB, { schema }));
    },
  },
);

// SAFETY: withSentry's return type marks fetch/queue/scheduled optional (a
// handler need not implement all three) and types fetch's request against
// Cloudflare's stricter IncomingRequestCfProperties, but the object above
// always provides all three, and it's the same app.fetch either way: Sentry
// wraps it without narrowing what request shape it accepts.
const handler: WorkerHandler = {
  fetch: wrapped.fetch! as typeof app.fetch,
  queue: wrapped.queue!,
  scheduled: wrapped.scheduled!,
};

export default handler;
