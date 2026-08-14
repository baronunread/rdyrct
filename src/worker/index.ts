import { Hono } from "hono";
import type { JsonValue } from "../shared/types";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, Env } from "./env";
import { withSession } from "./session";
import { getAuth } from "./better-auth";
import { withBackground } from "./background";
import { userRoutes } from "./routes/auth";
import { orgRoutes, inviteRoutes } from "./routes/orgs";
import { linkRoutes } from "./routes/links";
import { qrLogoRoutes } from "./routes/qr-logos";
import { adminRoutes } from "./routes/admin";
import { billingRoutes, handlePolarWebhook } from "./routes/billing";
import { domainRoutes } from "./routes/domains";
import { capRoutes } from "./routes/cap";
import { revalidateOnRedirect } from "./risk";
import { shortenRoutes, sweepExpiredAnonLinks } from "./routes/shorten";
import { resolveSlug, resolveDomain, type KVLink } from "./kv";
import { RESERVED_SLUGS } from "./util";
import { withPageMeta } from "./page-meta";
import { enforcePublicAuthRateLimit, enforceSignedApiRateLimit } from "./rate-limit";
import { applySecurityHeaders, isBlogPath } from "./security-headers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import {
  consumeStorageBatch,
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

app.onError((err, c) => {
  // JSON errors always: the SPA's api() reads res.json().message and spreads
  // the rest of the body onto ApiError.data, so a route's `cause` can carry
  // more than just a machine-readable `code` (e.g. same_destination_match's
  // matchedLinkId/matchedLink) straight through to the caller.
  const path = new URL(c.req.url).pathname;
  const respond = (body: ErrorBody, status: ContentfulStatusCode) => {
    const res = c.json(body, status);
    return isBlogPath(path) ? res : applySecurityHeaders(res);
  };
  if (err instanceof HTTPException) {
    return respond({ message: err.message, ...causeFields(err.cause) }, err.status);
  }
  console.error(err);
  return respond({ message: "Internal error" }, 500);
});

// Applies the security header baseline to every non-error response this
// Worker sends (see security-headers.ts): registered first, so it wraps
// every handler below (custom-domain redirects, the API, the blog proxy,
// shared-domain slug redirects, the SPA asset fallback).
//
// Assigning c.res, not mutating it: applySecurityHeaders returns a copy
// because some responses (ASSETS, Response.redirect) refuse header writes.
// Returning the response from here would not work — after next() the
// context is finalized, and hono's compose only adopts a returned response
// while it isn't.
app.use("*", async (c, next) => {
  await next();
  if (!isBlogPath(new URL(c.req.url).pathname)) c.res = applySecurityHeaders(c.res);
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

  const path = new URL(c.req.url).pathname;
  const slug = path.slice(1);
  if (slug && !slug.includes("/")) {
    const hit = await resolveSlug(c.env, slug, host);
    if (hit && isLive(hit)) return redirectWithClick(c, hit);
  }
  // root and misses land on the org's configured root redirect
  if (domain.rootRedirect) return c.redirect(domain.rootRedirect, 302);
  return c.text("Not found", 404);
});

/* ---------------- API ---------------- */

// BetterAuth owns /api/auth/* (signup, login, logout, verify, reset).
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
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
  const limited = await enforcePublicAuthRateLimit(c);
  return limited ?? next();
});
app.route("/api/cap", capRoutes);

// The landing page's anonymous shortener (Direction A of #96): public by
// definition, and gated by Cap plus its own rate-limit namespace rather than
// by a session.
app.route("/api/shorten", shortenRoutes);

// Polar webhook: public, signature-verified, no session middleware.
app.post("/api/webhooks/polar", (c) => handlePolarWebhook(c.req.raw, c.env));

const api = new Hono<AppEnv>();
api.use("*", withSession);
api.use("*", enforceSignedApiRateLimit);
api.route("/", userRoutes);
api.route("/orgs", orgRoutes);
api.route("/orgs/:orgId/links", linkRoutes);
api.route("/orgs/:orgId/qr-logo", qrLogoRoutes);
api.route("/billing", billingRoutes);
api.route("/orgs/:orgId/domains", domainRoutes);
api.route("/invites", inviteRoutes);
api.route("/admin", adminRoutes);
app.route("/api", api);

/* ---------------- blog: reverse-proxied Next.js app on Vercel ---------------- */

// The blog (rdyrct-blog, a separate Next.js repo) deploys to Vercel on its
// own; this keeps DNS and every other route on Cloudflare while the
// generated backlinks still resolve at rdyrct.com/blog. Next's `basePath`
// there mirrors this prefix, so the whole path tree (pages, /_next assets
// under /blog, sitemap) forwards unchanged.
function proxyBlog(c: Context<AppEnv>, next: () => Promise<void>) {
  if (!c.env.BLOG_ORIGIN_URL) return next();
  const url = new URL(c.req.url);
  const target = new URL(c.env.BLOG_ORIGIN_URL);
  target.pathname = url.pathname;
  target.search = url.search;

  // The blog needs no authenticated context: strip anything credential-bearing
  // before it leaves Cloudflare for a lower-trust, independently-deployed origin.
  const headers = new Headers(c.req.raw.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  headers.set("host", target.hostname);
  const hasBody = !["GET", "HEAD"].includes(c.req.raw.method);

  // `duplex` is what Workers' fetch needs to stream a request body, and its
  // RequestInit does not declare it, so it goes on after the object is built.
  const init: RequestInit & { duplex?: "half" } = {
    method: c.req.raw.method,
    headers,
    body: hasBody ? c.req.raw.body : undefined,
    redirect: "manual",
  };
  if (hasBody) init.duplex = "half";
  return fetch(target, init);
}
app.all("/blog", proxyBlog);
app.all("/blog/*", proxyBlog);

/* ---------------- shared-domain slug redirect ---------------- */

app.get("/:slug", async (c, next) => {
  const slug = c.req.param("slug");
  // Root keywords the SPA owns (/dashboard, /links, /login, …) never resolve as
  // slugs; they can't be created as slugs either, this is belt-and-suspenders.
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return next();
  const hit = await resolveSlug(c.env, slug, null);
  if (!hit || !isLive(hit)) return next(); // fall through to the SPA (404 page)
  return redirectWithClick(c, hit);
});

/* ---------------- SPA fallback ---------------- */

app.all("*", async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  // The SPA is one document for every route, so the head it ships describes
  // the landing page. Public pages get their own title, description and
  // canonical written in before the bytes leave (#96): a crawler or a link
  // preview reads those, and most of them never run the JavaScript that
  // would otherwise set them.
  return withPageMeta(response, new URL(c.req.url));
});

/* ---------------- Queue consumer: KV/R2 follow-up work + click ingestion ---------------- */

export default {
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
    if (batch.queue.endsWith("-clicks-dlq"))
      return logClickDeadLetterBatch(env, batch as MessageBatch<ClickMessage>);
    if (batch.queue.endsWith("-clicks"))
      return consumeClickBatch(env, batch as MessageBatch<ClickMessage>);
    if (batch.queue.endsWith("-dlq"))
      return logDeadLetterBatch(env, batch as MessageBatch<StorageMessage>);
    await consumeStorageBatch(env, batch as MessageBatch<StorageMessage>);
  },
  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
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

    // Daily: retire rename aliases past their 48h deadline (see #38). The
    // redirect path already stopped resolving them; this frees their slugs.
    await sweepExpiredAliases(env, drizzle(env.DB, { schema }));

    // Daily: drop anonymous links nobody claimed inside their 24 hours, and
    // the KV keys they were resolving through (Direction A of #96).
    await sweepExpiredAnonLinks(env);
  },
};
