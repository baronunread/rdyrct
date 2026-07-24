import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Env } from "./env";
import { withSession } from "./auth";
import { getAuth } from "./better-auth";
import { userRoutes } from "./routes/auth";
import { orgRoutes, inviteRoutes } from "./routes/orgs";
import { linkRoutes } from "./routes/links";
import { qrLogoRoutes } from "./routes/qr-logos";
import { adminRoutes } from "./routes/admin";
import { billingRoutes, handlePolarWebhook } from "./routes/billing";
import { domainRoutes } from "./routes/domains";
import { resolveSlug, resolveDomain, type KVLink } from "./kv";
import { RESERVED_SLUGS } from "./util";
import { enforcePublicAuthRateLimit, enforceSignedApiRateLimit } from "./rate-limit";
import { consumeStorageBatch, logDeadLetterBatch, type StorageMessage } from "./storage";
import {
  enqueueClick,
  consumeClickBatch,
  logClickDeadLetterBatch,
  type ClickMessage,
} from "./clicks";

export { OrgDeleteWorkflow, DomainActivateWorkflow } from "./workflows";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  // JSON errors always: the SPA's api() reads res.json().message (and an
  // optional machine-readable code, carried via HTTPException's cause)
  if (err instanceof HTTPException) {
    const code = (err.cause as { code?: string } | undefined)?.code;
    return c.json({ message: err.message, ...(code ? { code } : {}) }, err.status);
  }
  console.error(err);
  return c.json({ message: "Internal error" }, 500);
});

/* ---------------- redirect hot path ---------------- */

// Click recording happens after the redirect is already on its way
// (waitUntil): the request enqueues an event and returns rather than
// touching D1 itself. See clicks.ts.
function redirectWithClick(c: Context<AppEnv>, hit: KVLink): Response {
  c.executionCtx.waitUntil(enqueueClick(c, hit));
  return c.redirect(hit.url, 302);
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
    if (hit) return redirectWithClick(c, hit);
  }
  // root and misses land on the org's configured root redirect
  if (domain.rootRedirect) return c.redirect(domain.rootRedirect, 302);
  return c.text("Not found", 404);
});

/* ---------------- API ---------------- */

// BetterAuth owns /api/auth/* (signup, login, logout, verify, reset).
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const limited = await enforcePublicAuthRateLimit(c);
  return limited ?? getAuth(c.env).handler(c.req.raw);
});

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

/* ---------------- shared-domain slug redirect ---------------- */

app.get("/:slug", async (c, next) => {
  const slug = c.req.param("slug");
  // Root keywords the SPA owns (/dashboard, /links, /login, …) never resolve as
  // slugs; they can't be created as slugs either, this is belt-and-suspenders.
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return next();
  const hit = await resolveSlug(c.env, slug, null);
  if (!hit) return next(); // fall through to the SPA (404 page)
  return redirectWithClick(c, hit);
});

/* ---------------- SPA fallback ---------------- */

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

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
  },
};
