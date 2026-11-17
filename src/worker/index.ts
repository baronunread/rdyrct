import * as Sentry from "@sentry/cloudflare";
import { configureBilling } from "./plan";
import { Hono } from "hono";
import type { JsonValue } from "../shared/types";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { EvlogError } from "evlog";
import { methodNotAllowed } from "hono/method-not-allowed";
import { trimTrailingSlash } from "hono/trailing-slash";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, Env } from "./env";
import { withSession } from "./session";
import { withNoindex } from "./noindex";
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
import { linkImportRoutes } from "./routes/link-import";
import { linkExportRoutes } from "./routes/link-export";
import { apiKeyRoutes } from "./routes/api-keys";
import { oauthConnectionRoutes } from "./routes/oauth-connections";
import { mcpRoutes } from "./routes/mcp";
import { qrLogoRoutes } from "./routes/qr-logos";
import { avatarRoutes } from "./routes/avatars";
import { adminRoutes } from "./routes/admin";
import { unsubscribeRoutes } from "./unsubscribe";
import { billingRoutes, handlePolarWebhook } from "./routes/billing";
import { domainRoutes } from "./routes/domains";
import { revalidateOnRedirect } from "./risk";
import { forgetOldAnonWebRiskUsage, rescanFreeLinks, sweepAbuse } from "./destination-check";
import { sweepClickUsageEmails } from "./click-caps";
import { sweepOldOverflow } from "./click-overflow";
import { reportRoutes, sweepReportNotices, sweepStaleReportWarnings } from "./routes/reports";
import { asWideEvent, evlogMiddleware, evlogRequestContext } from "./evlog";
import { logFailure } from "./log-failure";
import { sweepGraceWarnings } from "./reconcile";
import { shortenRoutes, sweepExpiredAnonLinks } from "./routes/shorten";
import { defaultNativeRegistration, sweepAbandonedOAuthClients } from "./mcp-oauth";
import {
  resolveSlug,
  resolveDomain,
  domainServing,
  isHeld,
  type KVLink,
  type KVSlugValue,
} from "./kv";
import { disabledPage, heldPage, warnPage } from "./link-state-page";
import { purgeBannedOrgs, settleBannedOrgs } from "./abuse-hold";
import { madeWith, notFoundPage } from "./not-found-page";
import { appShellPage } from "../shared/app-shell";
import { RESERVED_SLUGS, SLUG_RE } from "./util";
import { markdownPage, withPageMeta } from "./page-meta";
import { PRERENDERED_PUBLIC_PATHS } from "../shared/page-meta";
import { RDYRCT_SITE } from "../shared/site";
import { canonicalSpaPath } from "../shared/spa-routes";
import { enforcePublicAuthRateLimit, enforceSignedApiRateLimit } from "./rate-limit";
import { applySecurityHeaders, turnstileAllowed } from "./security-headers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import {
  consumeStorageBatch,
  desiredLink,
  drainStorageOutbox,
  logDeadLetterBatch,
  sweepExpiredAliases,
  sweepOrphanQrLogos,
  type StorageMessage,
} from "./storage";

import { countAnonClick, enqueueClick, sweepDedupeIds } from "./clicks";
import { sweepOldRollups } from "./rollups";

export {
  OrgDeleteWorkflow,
  DomainActivateWorkflow,
  LinkImportWorkflow,
  NewsletterSendWorkflow,
} from "./workflows";
export { ClickBuffer } from "./click-buffer";

interface ErrorBody {
  message: string;
  [field: string]: JsonValue;
}

function causeFields(cause: unknown): Record<string, JsonValue> {
  // SAFETY: the only writers are this repo's own routes, which attach a
  // plain JSON object; the check above is what keeps anything else out.
  return cause instanceof Object && !Array.isArray(cause)
    ? (cause as Record<string, JsonValue>)
    : {};
}

const app = new Hono<AppEnv>();

// evlog emits only for /api/**, so non-API handlers guard log with ?. (evlog attaches
// nothing to filtered-out routes).
app.use(evlogMiddleware, evlogRequestContext);

app.onError((err, c) => {
  // api() on the client spreads the rest of the error body onto ApiError.data, so a route
  // cause can carry more than a code (same_destination_match).
  const respond = (body: ErrorBody, status: ContentfulStatusCode) =>
    applySecurityHeaders(c.json(body, status), turnstileAllowed(c.env, c.req.url));
  c.get("log")?.error(err);
  if (err instanceof HTTPException) {
    return respond({ message: err.message, ...causeFields(err.cause) }, err.status);
  }
  if (EvlogError.isEvlogError(err)) {
    // SAFETY: every createError() call site in this Worker passes a real
    // HTTP status (400-599); the fallback only covers a call that left it
    // unset, same default EvlogError itself applies.
    return respond(
      { message: err.message, ...(err.why && { why: err.why }), ...(err.fix && { fix: err.fix }) },
      (err.status ?? 500) as ContentfulStatusCode,
    );
  }
  Sentry.captureException(err);
  return respond({ message: "Internal error" }, 500);
});

// Registered first so it wraps every handler. Assign c.res, do not return it: after next()
// the context is finalized, and hono only adopts a returned response before that.
// applySecurityHeaders copies because ASSETS and Response.redirect refuse header writes.
app.use("*", async (c, next) => {
  await next();
  c.res = applySecurityHeaders(c.res, turnstileAllowed(c.env, c.req.url));
});

function redirectWithClick(c: Context<AppEnv>, hit: KVLink): Response {
  // An anonymous link has no org and no links row: a bare total only (#96).
  c.executionCtx.waitUntil(
    hit.orgId ? enqueueClick(c, hit) : countAnonClick(c.env, hit.linkId, c.req.method),
  );
  c.executionCtx.waitUntil(revalidateOnRedirect(c.env, hit));
  return c.redirect(hit.url, 302);
}

// A warning view records a click like a redirect: the abuse sweep counts clicks and would
// miss warned traffic. Continue goes straight to the destination (#344).
function serveLink(
  c: Context<AppEnv>,
  hit: KVSlugValue | null,
  home: string | null,
): Promise<Response> | null {
  if (!hit || !isLive(hit)) return null;
  if (isHeld(hit))
    return hit.disabled
      ? disabledPage(c.env.ASSETS, c.req.url, home)
      : heldPage(c.env.ASSETS, c.req.url);
  if (hit.warn) {
    c.executionCtx.waitUntil(
      hit.orgId ? enqueueClick(c, hit) : countAnonClick(c.env, hit.linkId, c.req.method),
    );
    return warnPage(c.env.ASSETS, c.req.url, hit.url);
  }
  return Promise.resolve(redirectWithClick(c, hit));
}

// == null on purpose: a KV value written before this field existed has it undefined,
// which must mean never expires. This check, not the sweep, enforces the deadline.
function isLive(hit: KVSlugValue): boolean {
  return hit.expiresAt == null || hit.expiresAt > Date.now();
}

// KV first, then D1 on a miss: KV can say not found after a failed write, or keep a miss for up to a minute.
// A D1 error is a miss, not a 500. A colon stops before KV: custom-domain keys are
// slug:<host>:<slug>, so /go.acme.com:promo on the shared host would read another tenant link.
async function resolveLink(
  c: Context<AppEnv>,
  slug: string,
  hostname: string | null,
): Promise<KVSlugValue | null> {
  if (slug.includes(":")) return null;
  const hit = await resolveSlug(c.env, slug, hostname);
  if (hit || !SLUG_RE.test(slug)) return hit;
  try {
    return await desiredLink(drizzle(c.env.DB, { schema }), slug, hostname);
  } catch (error) {
    c.get("log")?.error(error instanceof Error ? error : String(error));
    return null;
  }
}

// Redirect-only: SHARED_LINK_HOST must not fall through to the app, which would serve
// /api/auth/* without the WAF rules that exist only for APP_HOST (docs/rate-limiting.md).
async function resolveSharedLinkHost(c: Context<AppEnv>): Promise<Response> {
  const path = new URL(c.req.url).pathname;
  const slug = path.slice(1).replace(/\/+$/, "");
  if (!slug) return c.redirect(c.env.APP_URL, 302);
  if (!slug.includes("/") && !RESERVED_SLUGS.has(slug.toLowerCase())) {
    const served = serveLink(c, await resolveLink(c, slug, null), c.env.APP_URL);
    if (served) return served;
  }
  return notFoundPage(c.env.ASSETS, c.req.url, c.env.APP_URL);
}

// Hosts we do not know (*.workers.dev previews) fall through to the app.
app.use("*", async (c, next) => {
  const host = c.req.header("host")?.toLowerCase();
  if (!host || host === c.env.APP_HOST.toLowerCase()) return next();
  if (host === c.env.SHARED_LINK_HOST?.toLowerCase()) return resolveSharedLinkHost(c);

  const domain = await resolveDomain(c.env, host);
  if (!domain) return next();
  // A 404, not a page explaining the downgrade: most of what reaches a dead short link is a machine (#159).
  if (!domainServing(domain)) return notFoundPage(c.env.ASSETS, c.req.url, null);
  if (domain.disabled) return disabledPage(c.env.ASSETS, c.req.url, null);

  const path = new URL(c.req.url).pathname;
  // Never calls next(), so trim the trailing slash here: trimTrailingSlash below never runs for a custom domain.
  const slug = path.slice(1).replace(/\/+$/, "");
  if (slug && !slug.includes("/")) {
    const served = serveLink(c, await resolveLink(c, slug, host), null);
    if (served) return served;
  }
  if (domain.rootRedirect) return c.redirect(domain.rootRedirect, 302);
  return notFoundPage(c.env.ASSETS, c.req.url, null);
});

// A GET with a trailing slash would reach the SPA under a 200 (hono /:slug match is exact).
app.use("*", trimTrailingSlash({ alwaysRedirect: true }));

// Turns a 404 on a path served under another method into 405 with Allow. The SPA app.all(*)
// is skipped when collecting what a path allows.
app.use(
  methodNotAllowed<AppEnv>({
    app,
    onMethodNotAllowed: (c, methods) =>
      c.json({ message: "Method not allowed" }, 405, { Allow: methods.join(", ") }),
  }),
);

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
  // withBackground: an auth hook sends mail after the response, so signup timing does not
  // depend on whether the address exists (#53).
  const request = await defaultNativeRegistration(c.req.raw);
  return withBackground(c.executionCtx, () => getAuth(c.env).handler(request));
});

// Both discovery paths live at the site origin, not under /api/auth. RFC 8414 inserts /.well-known before the
// issuer path, so spec-compliant clients (the claude mcp add CLI) never try the suffix form BetterAuth serves.
// No audit or rate limit: public, cacheable metadata.
app.on(
  ["GET", "HEAD"],
  [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/api/auth",
    "/.well-known/openid-configuration",
    "/.well-known/openid-configuration/api/auth",
  ],
  (c) => getAuth(c.env).handler(c.req.raw),
);

// Public, gated by Turnstile and its own rate-limit namespace (#96). Only rdyrct.com takes links from strangers.
if (RDYRCT_SITE) app.route("/api/shorten", shortenRoutes);

app.route("/api/reports", reportRoutes);

// import.meta.env.DEV is build-time and the import dynamic, so production drops the module
// (a static import would keep its route registrations as side effects).
if (import.meta.env.DEV)
  app.all("/__dev/*", async (c) => (await import("./dev-scenarios")).handleDev(c));

// In every build: any copy that sends a newsletter must let people unsubscribe.
app.route("/unsubscribe", unsubscribeRoutes);

app.post("/api/webhooks/polar", (c) => {
  const log = c.get("log");
  log.set({ route: c.req.path });
  return handlePolarWebhook(c.req.raw, c.env);
});

const api = new Hono<AppEnv>();
// withSession allows an OAuth token on /api/mcp only (#242).
api.use("*", withSession({ oauthTokenPath: "/api/mcp" }));
api.use("*", enforceSignedApiRateLimit);
// Enrich before await next() so a short-circuited response (a 429) keeps the user on the wide event.
api.use("*", async (c, next) => {
  const user = c.get("user");
  if (user) c.get("log")?.set({ user: { id: user.id, plan: user.plan } });
  await next();
});
api.route("/", userRoutes);
api.route("/orgs", orgRoutes);
api.route("/orgs/:orgId/links", linkRoutes);
api.route("/orgs/:orgId/link-import", linkImportRoutes);
api.route("/orgs/:orgId/link-export", linkExportRoutes);
api.route("/orgs/:orgId/qr-logo", qrLogoRoutes);
api.route("/user/avatar", avatarRoutes);
api.route("/billing", billingRoutes);
api.route("/orgs/:orgId/domains", domainRoutes);
api.route("/orgs/:orgId/api-keys", apiKeyRoutes);
api.route("/oauth-connections", oauthConnectionRoutes);
api.route("/invites", inviteRoutes);
api.route("/admin", adminRoutes);
api.route("/mcp", mcpRoutes);
app.route("/api", api);

app.all("/api/*", (c) => {
  // log is absent for a bare /api: evlog include globs do not match it.
  c.get("log")?.set({ route: c.req.path });
  return c.json({ message: "Not found" }, 404);
});

// Public pages get their title, description and canonical written in before the bytes leave (#96):
// crawlers and previews do not run the JS. status overrides ASSETS, which answers the SPA shell under a 200.
// Only the shell may become a 404: real files (/@react-refresh in dev) arrive as themselves.

// The shell carries the asset server ETag and must-revalidate. Copied onto a 404, the browser got
// a 304 with no body on the next visit and rendered a blank page.
function uncacheable404(body: BodyInit | null, from?: Headers): Response {
  const headers = new Headers(from);
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  return new Response(body, { status: 404, headers });
}

// For unhashed static files that reach serveSpa: public/_headers covers the known ones, this a root file added later.
const STATIC_CACHE = "public, max-age=3600, must-revalidate";

async function servePrerenderedPage(c: Context<AppEnv>, url: URL): Promise<Response | null> {
  if (
    (c.req.method !== "GET" && c.req.method !== "HEAD") ||
    !PRERENDERED_PUBLIC_PATHS.has(url.pathname)
  )
    return null;
  const assetPath = url.pathname === "/" ? null : `/_prerendered${url.pathname}.txt${url.search}`;
  if (!assetPath) return null;
  const asset = await c.env.ASSETS.fetch(new Request(new URL(assetPath, url.origin), c.req.raw));
  if (asset.status !== 200 && asset.status !== 304) return null;
  const headers = new Headers(asset.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  return withPageMeta(
    new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers }),
    url,
    c.env.SITE_NAME,
  );
}

async function serveAppShell(c: Context<AppEnv>, url: URL): Promise<Response | null> {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return null;
  const page = appShellPage(url.pathname);
  if (!page) return null;
  const asset = await c.env.ASSETS.fetch(
    new Request(new URL(`/_app-shell/${page}.txt`, url.origin), c.req.raw),
  );
  if (asset.status !== 200 && asset.status !== 304) return null;
  // A missing file answers 200 with index.html, which in production has the landing page baked into #root.
  // The shell files are .txt, so HTML means none.
  if (asset.headers.get("content-type")?.includes("text/html")) return null;
  const headers = new Headers(asset.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  return finalizeSpaResponse(
    new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers }),
    url,
    c.env.SITE_NAME,
    undefined,
    true,
  );
}

function cacheStaticAsset(response: Response): Response {
  const cached = new Response(response.body, response);
  cached.headers.set("cache-control", STATIC_CACHE);
  return cached;
}

function finalizeSpaResponse(
  response: Response,
  url: URL,
  siteName: string | undefined,
  status?: 404,
  appShell = false,
): Response {
  const page = withPageMeta(response, url, siteName, appShell);
  if (page.status !== 200) return page;
  if (!page.headers.get("content-type")?.includes("text/html")) {
    return import.meta.env.DEV ? page : cacheStaticAsset(page);
  }
  return status ? uncacheable404(page.body, page.headers) : page;
}

// Check the shell before the status, never after: /:slug sends every single-segment path here, and some are real files (/@react-refresh).
// STATIC_CACHE is production only: in dev it would cache the source modules you just edited.
async function serveSpa(c: Context<AppEnv>, status?: 404): Promise<Response> {
  return withNoindex(await spaResponse(c, status), new URL(c.req.url));
}

async function spaResponse(c: Context<AppEnv>, status?: 404): Promise<Response> {
  const url = new URL(c.req.url);
  if (!status && c.req.method === "GET") {
    const markdown = markdownPage(url, c.req.header("accept"));
    if (markdown) return markdown;
  }
  if (!status) {
    const prerendered = await servePrerenderedPage(c, url);
    if (prerendered) return prerendered;
  }
  if (!status) {
    const shell = await serveAppShell(c, url);
    if (shell) return withoutMadeWith(shell);
  }
  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  return withoutMadeWith(finalizeSpaResponse(assetResponse, url, c.env.SITE_NAME, status));
}

// A fork must not advertise us: the same rule madeWith applies on the redirect path.
function withoutMadeWith(response: Response): Response {
  if (RDYRCT_SITE || !response.headers.get("content-type")?.includes("text/html")) return response;
  return madeWith(new HTMLRewriter(), null, "page").transform(response);
}

if (!RDYRCT_SITE)
  app.get("/", (c) => {
    c.get("log")?.set({ route: c.req.path, redirect: { to: "/dashboard", why: "self-hosted" } });
    return c.redirect("/dashboard", 302);
  });

app.get("/pricing.md", (c) => {
  if (!RDYRCT_SITE) return serveSpa(c, 404);
  c.get("log")?.set({ route: c.req.path });
  const canonicalUrl = new URL(c.req.url);
  canonicalUrl.pathname = "/pricing";
  return (
    markdownPage(canonicalUrl, "text/markdown") ??
    new Response("The pricing page has no Markdown source.", { status: 404 })
  );
});

app.get("/:slug", async (c, next) => {
  const slug = c.req.param("slug");
  c.get("log")?.set({ slug });
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return next();
  const served = serveLink(c, await resolveLink(c, slug, null), c.env.APP_URL);
  if (served) return served;
  return serveSpa(c, 404);
});

// Only the SPA own pages: anything else is a 404 carrying the NotFound screen. serveSpa only turns the HTML shell into a 404.
// A known page in the wrong case (/PRICING) moves to its real address. Only fixed segments are lowercased:
// a slug or invite token keeps its case.
app.all("*", async (c) => {
  const url = new URL(c.req.url);
  c.get("log")?.set({ route: url.pathname });
  const canonical = canonicalSpaPath(url.pathname);
  if (canonical === url.pathname) return serveSpa(c);
  if (canonical && (c.req.method === "GET" || c.req.method === "HEAD")) {
    url.pathname = canonical;
    return c.redirect(url.toString(), 301);
  }
  return serveSpa(c, 404);
});

// Typed explicitly: withSentry generic return makes fetch/queue/scheduled optional, which would make
// every test call to worker.fetch(...) possibly undefined.
type WorkerHandler = {
  fetch: typeof app.fetch;
  queue: ExportedHandlerQueueHandler<Env, StorageMessage>;
  scheduled: ExportedHandlerScheduledHandler<Env>;
};

async function runIsolated(tasks: Array<() => Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(tasks.map((task) => task()));
  for (const result of results) {
    if (result.status === "rejected") {
      Sentry.captureException(result.reason);
      logFailure("scheduled_task_failed", result.reason);
    }
  }
}

const wrapped = Sentry.withSentry<
  Env,
  StorageMessage,
  unknown,
  ExportedHandler<Env, StorageMessage>
>(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    // Sentry 11 collects every category by default (headers carry the visitor IP and session cookie); turn each off.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      databaseQueryData: false,
      queues: false,
    },
  }),
  {
    fetch: app.fetch,
    queue: (batch: MessageBatch<StorageMessage>, env: Env, ctx: ExecutionContext) =>
      asWideEvent(ctx, { kind: "queue", name: batch.queue, size: batch.messages.length }, () =>
        consumeQueue(batch, env),
      ),
    scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) =>
      asWideEvent(ctx, { kind: "cron", name: controller.cron }, () =>
        runScheduled(controller, env),
      ),
  },
);

async function consumeQueue(batch: MessageBatch<StorageMessage>, env: Env): Promise<void> {
  configureBilling(env);
  // The dead-letter consumer routes here too (wrangler.jsonc): DLQ messages are only logged, never retried.
  if (batch.queue.endsWith("-dlq")) return logDeadLetterBatch(env, batch);
  await consumeStorageBatch(env, batch);
  // Also drain a bounded slice of the outbox (#228): recovers a failed send within seconds of the queue coming back.
  await drainStorageOutbox(env);
}

async function runScheduled(controller: ScheduledController, env: Env): Promise<void> {
  configureBilling(env);
  // Frequent trigger: drain the outbox when a frozen queue skipped it (#228), and catch an org flooding the redirect path (#224).
  // Only the daily string runs the batch below. Isolated: one throwing must not stop the other.
  if (controller.cron !== "0 6 * * *") {
    await runIsolated([
      async () => void (await drainStorageOutbox(env)),
      () => sweepAbuse(env),
      async () => void (await sweepClickUsageEmails(env)),
      async () => void (await sweepReportNotices(env)),
    ]);
    return;
  }

  const cutoff = Date.now() - 400 * 24 * 60 * 60 * 1000;
  // Bounded batches: one unbounded DELETE can hit D1 statement limits.
  const stmt = env.DB.prepare(
    `delete from clicks where id in (select id from clicks where ts < ? limit 1000)`,
  );
  let changes = 0;
  do {
    changes = (await stmt.bind(cutoff).run()).meta.changes;
  } while (changes > 0);

  // Separate from the raw cutoff so that one can shrink alone (#26). Isolated: rows it fails to drop today it drops tomorrow.
  await runIsolated([() => sweepOldRollups(env)]);

  await sweepOldOverflow(env);

  await sweepDedupeIds(env);

  await sweepOrphanQrLogos(env);

  // createBatch skips an id already in use whatever its state, so an errored workflow is never replaced by a later DELETE (#52).
  await sweepStalledOrgDeletions(drizzle(env.DB, { schema }), env);

  // Finish what migration 0046 could not do before this Worker deployed, and delete orgs banned over 90 days ago.
  // Isolated; the outbox drain at the end publishes what the first queued.
  await runIsolated([
    () => settleBannedOrgs(drizzle(env.DB, { schema })),
    () => purgeBannedOrgs(env, drizzle(env.DB, { schema })).then(() => {}),
  ]);

  await sweepExpiredAliases(env, drizzle(env.DB, { schema }));

  await sweepExpiredInvites(env);

  await sweepExpiredAnonLinks(env);

  await forgetOldAnonWebRiskUsage(env.DB);

  await sweepAbandonedOAuthClients(env);

  await sweepGraceWarnings(env, drizzle(env.DB, { schema }));

  // Isolated from each other and from every sweep above: one throwing must not stop another starting.
  await runIsolated([
    async () => void (await drainStorageOutbox(env)),
    () => sweepAbuse(env),
    async () => void (await rescanFreeLinks(env)),
    async () => void (await sweepStaleReportWarnings(env)),
    async () => void (await sweepClickUsageEmails(env)),
  ]);
}

// SAFETY: withSentry marks fetch/queue/scheduled optional, but the object above
// always provides all three, and it is the same app.fetch either way.
const handler: WorkerHandler = {
  fetch: wrapped.fetch! as typeof app.fetch,
  queue: wrapped.queue!,
  scheduled: wrapped.scheduled!,
};

export default handler;
