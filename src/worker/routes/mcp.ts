import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createError, EvlogError } from "evlog";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import * as QRCode from "qrcode";
import type { JsonValue } from "../../shared/types";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { requireMcpAuth } from "@better-auth/mcp";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env, SessionUser } from "../env";
import { withSession } from "../session";
import { getAuth } from "../better-auth";
import { mcpResource } from "../mcp-oauth";
import { enforceSignedApiRateLimit } from "../rate-limit";
import { orgRole } from "../org-role";
import { orgPlan, countActiveAddresses } from "../plan";
import { linkRoutes } from "./links";
import { orgRoutes } from "./orgs";
import { isValidHttpUrl } from "../util";
import { jsonBodyLimit } from "../body-limit";

// Mounted at /api/mcp, inside the same `api` sub-app as everything else
// (withSession + enforceSignedApiRateLimit already ran, so c.var.user is
// resolved from either a session cookie or a scoped API key, see
// session.ts). This is the remote MCP server (#139): the tools below are the
// chatbot-connector surface, a different consumer than the WebMCP tools in
// src/app/components/webmcp-*.tsx (browser-only, session-cookie-only, left
// untouched — people are testing those right now).

/**
 * Dispatches a tool call into the real route handler, in-process. Every
 * mutating tool goes through this instead of a second copy of the route's
 * logic (same-destination matching, quota checks, KV/storage sync): the
 * plan caps, role checks and error shapes are the API's, not re-implemented
 * here (see #139 "Scopes are enforced by the API, not re-implemented in the
 * tool layer"). withSession runs again on this inner request because a
 * fresh `app.request()` call starts a fresh Hono context; it re-resolves the
 * same key or session the outer request already authenticated.
 */
const internal = new Hono<AppEnv>();
internal.use("*", withSession);
internal.use("*", enforceSignedApiRateLimit);
internal.route("/orgs", orgRoutes);
internal.route("/orgs/:orgId/links", linkRoutes);

interface DispatchResult {
  status: number;
  json: JsonValue | null;
}

/** Hono's own `ExecutionContext` (from `c.executionCtx`), not the ambient
 * Workers-runtime one: the two are structurally different, and `internal.
 * request()` below wants the former. */
type ExecCtx = Context<AppEnv>["executionCtx"];

async function dispatch(
  env: Env,
  ctx: ExecCtx,
  authorization: string,
  method: string,
  path: string,
  body?: Record<string, JsonValue | undefined>,
): Promise<DispatchResult> {
  const headers = new Headers({ authorization });
  if (body !== undefined) headers.set("content-type", "application/json");
  const res = await internal.request(
    path,
    { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined },
    env,
    ctx,
  );
  // SAFETY: every route mounted on `internal` answers with `c.json(...)`, so
  // a parseable body is always a JsonValue; an unparseable one (an empty
  // 204, a crash) is the `null` this falls back to.
  const json = (await res.json().catch(() => null)) as JsonValue | null;
  return { status: res.status, json };
}

const errorBodySchema = v.object({ message: v.string() });

/** A dispatched call's JSON body, once its status confirms success — the
 * shape every tool wants back rather than the raw {status, json} pair. */
function ok(result: DispatchResult): JsonValue {
  if (result.status >= 200 && result.status < 300) return result.json ?? {};
  const parsed = v.safeParse(errorBodySchema, result.json);
  const message = parsed.success
    ? parsed.output.message
    : `Request failed with status ${result.status}`;
  // SAFETY: `result.status` always came out of a Response this same Worker
  // built (internal.request), so it is a valid HTTP status code.
  throw createError({
    status: result.status as ContentfulStatusCode,
    message,
    why: "The underlying API route refused the request.",
    fix: "Read the message: it is the same one the REST API itself returns.",
  });
}

function textResult(value: JsonValue): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Parses a tool's raw arguments without throwing: `v.parse`'s ValiError,
 * left to propagate up through the MCP SDK's own request-dispatch promise
 * chain, surfaces there as an unhandled rejection even once our own
 * try/catch in mcpRoutes.all() has already turned it into a clean
 * CallToolResult (security-audit finding, #139) — safeParse and an
 * early-return keeps a bad tool argument from ever being a thrown
 * exception in the first place. */
function parseArgs<T>(
  schema: v.GenericSchema<unknown, T>,
  raw: JsonValue | undefined,
): { ok: true; value: T } | { ok: false; result: CallToolResult } {
  const parsed = v.safeParse(schema, raw);
  if (parsed.success) return { ok: true, value: parsed.output };
  return { ok: false, result: errorResult(parsed.issues[0]?.message ?? "Invalid arguments.") };
}

/* ---------------- org resolution ---------------- */

async function userOrgs(db: DB, userId: string): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: schema.orgs.id, name: schema.orgs.name })
    .from(schema.orgMembers)
    .innerJoin(schema.orgs, eq(schema.orgMembers.orgId, schema.orgs.id))
    .where(eq(schema.orgMembers.userId, userId));
}

/** Every tool takes an optional `org_id`, since the person may belong to
 * more than one organization. Absent, and there is exactly one, that one is
 * assumed (the common case); absent with more than one, the tool asks
 * rather than guessing which the person meant. */
async function resolveOrg(db: DB, user: SessionUser, orgId: string | undefined): Promise<string> {
  if (orgId) {
    if (!(await orgRole(db, user, orgId)))
      throw createError({
        status: 400,
        message: `You are not a member of organization "${orgId}".`,
        why: "The org_id argument named an organization you don't belong to.",
        fix: "Use an org_id you're a member of, or omit it.",
      });
    return orgId;
  }
  const orgs = await userOrgs(db, user.id);
  if (orgs.length === 1) return orgs[0]!.id;
  if (orgs.length === 0)
    throw createError({
      status: 400,
      message: "You have no organization yet.",
      why: "Every tool needs an organization to act on.",
      fix: "Create one first.",
    });
  const names = orgs.map((o) => `${o.name} (${o.id})`).join(", ");
  throw createError({
    status: 400,
    message: `You belong to more than one organization: ${names}. Say which one (org_id).`,
    why: "org_id was omitted and more than one organization matched.",
    fix: "Call the tool again with an explicit org_id.",
  });
}

/** "my domain" as a hostname resolves to the org's active custom domain id,
 * the way create_link's `domainId` field expects it — a person naming a
 * domain thinks of it as "rdyrct.com" (well, their own), not a row id. */
async function resolveDomainId(db: DB, orgId: string, hostname: string): Promise<string> {
  const rows = await db
    .select({ id: schema.domains.id, status: schema.domains.status })
    .from(schema.domains)
    .where(and(eq(schema.domains.orgId, orgId), eq(schema.domains.hostname, hostname)));
  const row = rows[0];
  if (!row)
    throw createError({
      status: 400,
      message: `"${hostname}" is not one of this organization's domains.`,
      why: "The domain argument didn't match a domain on this organization.",
      fix: "Check the hostname, or omit domain to use the shared domain.",
    });
  if (row.status !== "active")
    throw createError({
      status: 400,
      message: `"${hostname}" is not active yet (still ${row.status}).`,
      why: "A link can only go on a domain that has finished DNS/TLS setup.",
      fix: "Wait for the domain to become active, or omit domain.",
    });
  return row.id;
}

/* ---------------- finding a link by what a person would say ---------------- */

interface LinkSummary {
  id: string;
  slug: string;
  domain: string | null;
  destination: string;
  title: string;
  clicks: number;
}

async function searchLinks(
  env: Env,
  ctx: ExecCtx,
  authorization: string,
  orgId: string,
  query: string,
): Promise<LinkSummary[]> {
  const params = new URLSearchParams({ q: query, limit: "10" });
  const result = ok(
    await dispatch(env, ctx, authorization, "GET", `/orgs/${orgId}/links?${params}`),
  );
  const page = v.parse(
    v.object({
      items: v.array(
        v.object({
          id: v.string(),
          slug: v.string(),
          domain: v.nullable(v.string()),
          destination: v.string(),
          title: v.string(),
          clicks: v.number(),
        }),
      ),
    }),
    result,
  );
  return page.items;
}

/** Resolves "the link at that slug" or "the link pointing to that URL" to
 * one id, the way a person would refer to it in a sentence rather than by
 * database id. Throws with the candidates named when more than one link
 * matches, rather than silently acting on the wrong one. */
async function findOneLink(
  env: Env,
  ctx: ExecCtx,
  authorization: string,
  orgId: string,
  by: { slug?: string; destination?: string },
): Promise<LinkSummary> {
  const needle = by.slug ?? by.destination;
  if (!needle)
    throw createError({
      status: 400,
      message: "Give either a slug or a destination URL to find the link.",
      why: "Neither slug nor destination was given.",
      fix: "Pass one of them.",
    });
  const candidates = await searchLinks(env, ctx, authorization, orgId, needle);
  const matches = by.slug
    ? candidates.filter((l) => l.slug === by.slug)
    : candidates.filter((l) => l.destination.includes(by.destination!));
  if (matches.length === 0)
    throw createError({
      status: 404,
      message: `No link found matching "${needle}".`,
      why: "Nothing in this organization's links matched.",
      fix: "Check the slug or destination and try again.",
    });
  if (matches.length > 1) {
    const listed = matches.map((l) => `${l.slug} → ${l.destination}`).join(", ");
    throw createError({
      status: 400,
      message: `More than one link matches "${needle}": ${listed}. Say which slug you mean.`,
      why: "The destination substring matched more than one link.",
      fix: "Use the exact slug instead.",
    });
  }
  return matches[0]!;
}

/* ---------------- tool schemas ---------------- */

const orgIdField = v.optional(v.string());

const createLinkArgs = v.object({
  destination: v.pipe(v.string(), v.trim(), v.minLength(1)),
  slug: v.optional(v.string()),
  title: v.optional(v.string()),
  domain: v.optional(v.string()),
  org_id: orgIdField,
});

const findByField = v.object({
  slug: v.optional(v.string()),
  destination: v.optional(v.string()),
});

const updateLinkArgs = v.object({
  ...findByField.entries,
  new_destination: v.optional(v.string()),
  title: v.optional(v.string()),
  org_id: orgIdField,
});

const deleteLinkArgs = v.object({ ...findByField.entries, org_id: orgIdField });

const listLinksArgs = v.object({ query: v.optional(v.string()), org_id: orgIdField });

const linkStatsArgs = v.object({
  slug: v.pipe(v.string(), v.trim(), v.minLength(1)),
  domain: v.optional(v.string()),
  org_id: orgIdField,
});

const orgStatsArgs = v.object({
  days: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365))),
  org_id: orgIdField,
});

const planUsageArgs = v.object({ org_id: orgIdField });

const inviteArgs = v.object({
  email: v.pipe(v.string(), v.trim(), v.email()),
  role: v.optional(v.picklist(["viewer", "member", "admin"]), "member"),
  org_id: orgIdField,
});

// generate_qr_code is the one tool with no org-membership check (see the
// handler below), so this length cap is its only real cost control before
// the url reaches the qrcode library's own proportional-cost encoding work.
const qrArgs = v.object({ url: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(2048)) });

/* ---------------- tool list (protocol-facing JSON Schema) ---------------- */

const TOOLS: Tool[] = [
  {
    name: "create_link",
    description: "Shorten a URL into an rdyrct link. Returns the short link and its destination.",
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "The URL to shorten" },
        slug: {
          type: "string",
          description: "A chosen slug, custom domains only. Omit for random.",
        },
        title: { type: "string", description: "An optional label for the link" },
        domain: {
          type: "string",
          description: "Put it on this custom domain instead of the shared one",
        },
        org_id: {
          type: "string",
          description: "Which organization, if the person has more than one",
        },
      },
      required: ["destination"],
    },
  },
  {
    name: "update_link",
    description:
      'Point an existing link at a new destination, or rename its title. Find it by slug (e.g. "promo") or by its current destination URL.',
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: 'The link\'s slug, e.g. "promo"' },
        destination: {
          type: "string",
          description: "The link's current destination, to find it by",
        },
        new_destination: { type: "string", description: "The new destination URL" },
        title: { type: "string" },
        org_id: { type: "string" },
      },
    },
  },
  {
    name: "delete_link",
    description: "Delete a link. Find it by slug or by the destination URL it points to.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
        destination: { type: "string", description: "The destination URL it points to" },
        org_id: { type: "string" },
      },
    },
  },
  {
    name: "list_links",
    description: "Search or list an organization's links, with their click counts.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filter by slug, destination or title" },
        org_id: { type: "string" },
      },
    },
  },
  {
    name: "get_link_stats",
    description:
      "How many clicks one link has gotten, and where from: countries, referrers and devices.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: 'The link\'s slug, e.g. "promo"' },
        domain: { type: "string", description: "Its custom domain, if not on the shared domain" },
        org_id: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "get_org_stats",
    description:
      "An organization's links overall: total and recent clicks, the top-performing links, and links with no clicks in the last 30 days.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "The analytics window, in days. Defaults to 7." },
        org_id: { type: "string" },
      },
    },
  },
  {
    name: "get_plan_usage",
    description:
      "How many links the organization is allowed on its current plan, and how many are left.",
    inputSchema: { type: "object", properties: { org_id: { type: "string" } } },
  },
  {
    name: "invite_member",
    description: "Invite someone to an organization by email.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string" },
        role: {
          type: "string",
          enum: ["viewer", "member", "admin"],
          description: "Defaults to member",
        },
        org_id: { type: "string" },
      },
      required: ["email"],
    },
  },
  {
    name: "generate_qr_code",
    description: "Make a QR code for a URL. Returns a PNG image.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
];

/* ---------------- tool handlers ---------------- */

/** Everything a tool handler needs, bundled once instead of threaded through
 * six positional parameters each (the switch this replaced was flagged HIGH
 * complexity: one function holding every tool's logic inline). */
interface ToolCtx {
  env: Env;
  ctx: ExecCtx;
  db: DB;
  user: SessionUser;
  authorization: string;
  rawArgs: JsonValue | undefined;
}

type ToolHandler = (t: ToolCtx) => Promise<CallToolResult>;

async function createLink(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(createLinkArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  const orgId = await resolveOrg(t.db, t.user, args.org_id);
  const domainId = args.domain ? await resolveDomainId(t.db, orgId, args.domain) : undefined;
  const dto = ok(
    await dispatch(t.env, t.ctx, t.authorization, "POST", `/orgs/${orgId}/links`, {
      destination: args.destination,
      slug: args.slug,
      title: args.title,
      domainId,
    }),
  );
  return textResult(dto);
}

async function updateLink(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(updateLinkArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  const orgId = await resolveOrg(t.db, t.user, args.org_id);
  const link = await findOneLink(t.env, t.ctx, t.authorization, orgId, args);
  const dto = ok(
    await dispatch(t.env, t.ctx, t.authorization, "PATCH", `/orgs/${orgId}/links/${link.id}`, {
      destination: args.new_destination,
      title: args.title,
    }),
  );
  return textResult(dto);
}

async function deleteLink(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(deleteLinkArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  const orgId = await resolveOrg(t.db, t.user, args.org_id);
  const link = await findOneLink(t.env, t.ctx, t.authorization, orgId, args);
  ok(await dispatch(t.env, t.ctx, t.authorization, "DELETE", `/orgs/${orgId}/links/${link.id}`));
  return textResult({ deleted: link.slug });
}

async function listLinksTool(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(listLinksArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  const orgId = await resolveOrg(t.db, t.user, args.org_id);
  const links = await searchLinks(t.env, t.ctx, t.authorization, orgId, args.query ?? "");
  // SAFETY: a round trip, not a cast on the original value — LinkSummary
  // (built by v.parse in searchLinks) is already plain JSON, but as a named
  // interface it has no index signature, so TS never considers it a
  // structural JsonValue; JSON.parse's return is genuinely one. Not a deep
  // clone: structuredClone would preserve LinkSummary's exact (non-JsonValue)
  // type instead of widening it, which is the whole point of the round trip.
  // eslint-disable-next-line react-doctor/no-json-parse-stringify-clone
  return textResult(JSON.parse(JSON.stringify(links)) as JsonValue);
}

async function getLinkStats(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(linkStatsArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  const orgId = await resolveOrg(t.db, t.user, args.org_id);
  const qs = args.domain ? `?domain=${encodeURIComponent(args.domain)}` : "";
  const stats = ok(
    await dispatch(
      t.env,
      t.ctx,
      t.authorization,
      "GET",
      `/orgs/${orgId}/links/stats/${encodeURIComponent(args.slug)}${qs}`,
    ),
  );
  return textResult(stats);
}

async function getOrgStats(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(orgStatsArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  const orgId = await resolveOrg(t.db, t.user, args.org_id);
  const qs = args.days ? `?days=${args.days}` : "";
  const stats = ok(
    await dispatch(t.env, t.ctx, t.authorization, "GET", `/orgs/${orgId}/stats${qs}`),
  );
  return textResult(stats);
}

async function getPlanUsage(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(planUsageArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  const orgId = await resolveOrg(t.db, t.user, args.org_id);
  const [{ plan, limits }, used] = await Promise.all([
    orgPlan(t.db, orgId),
    countActiveAddresses(t.db, orgId),
  ]);
  return textResult({ plan, allowed: limits.links, used, left: Math.max(0, limits.links - used) });
}

async function inviteMember(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(inviteArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  const orgId = await resolveOrg(t.db, t.user, args.org_id);
  const result = ok(
    await dispatch(t.env, t.ctx, t.authorization, "POST", `/orgs/${orgId}/invites`, {
      role: args.role,
      emails: [args.email],
    }),
  );
  return textResult(result);
}

async function generateQrCode(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(qrArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  if (!isValidHttpUrl(args.url)) return errorResult("That is not a valid http(s) URL.");
  const png = new Uint8Array(await QRCode.toBuffer(args.url, { width: 512, margin: 2 }));
  let binary = "";
  for (let i = 0; i < png.length; i++) binary += String.fromCharCode(png[i]!);
  return { content: [{ type: "image", data: btoa(binary), mimeType: "image/png" }] };
}

const TOOL_HANDLERS = {
  create_link: createLink,
  update_link: updateLink,
  delete_link: deleteLink,
  list_links: listLinksTool,
  get_link_stats: getLinkStats,
  get_org_stats: getOrgStats,
  get_plan_usage: getPlanUsage,
  invite_member: inviteMember,
  generate_qr_code: generateQrCode,
} satisfies Record<string, ToolHandler>;

async function handleTool(name: string, t: ToolCtx): Promise<CallToolResult> {
  if (!Object.hasOwn(TOOL_HANDLERS, name)) return errorResult(`Unknown tool "${name}".`);
  // SAFETY: the hasOwn check above confirms `name` is one of TOOL_HANDLERS'
  // own literal keys (not an inherited one, unlike `in`), which is exactly
  // what `keyof typeof TOOL_HANDLERS` is.
  return TOOL_HANDLERS[name as keyof typeof TOOL_HANDLERS](t);
}

/* ---------------- wiring ---------------- */

export const mcpRoutes = new Hono<AppEnv>();
mcpRoutes.use("*", jsonBodyLimit());

mcpRoutes.all("/", async (c) => {
  const log = c.get("log");
  log.set({ route: "/api/mcp" });
  const user = c.var.user;
  const authorization = c.req.header("authorization");
  if (!user || !authorization) {
    // withSession (session.ts) already tried a cookie, an API key, and an
    // OAuth access token and found none of them; requireMcpAuth's own
    // independent re-check exists here only to build the RFC 9728
    // WWW-Authenticate challenge correctly (the resource-metadata URL, the
    // realm) rather than hand-rolling that header. Its handler firing would
    // mean it accepted a token session.ts just rejected — session.ts and
    // this call verify the same signature/issuer/audience, so that would be
    // a real bug, not a race; treated as the same 401 either way.
    return requireMcpAuth(
      getAuth(c.env),
      () => {
        throw createError({
          status: 401,
          message: "Not signed in",
          why: "This endpoint takes an OAuth access token or a scoped API key, not a browser session.",
          fix: "Connect via OAuth from an MCP client, or send Authorization: Bearer <api key> minted from API keys.",
        });
      },
      { resource: mcpResource(c.env) },
    )(c.req.raw);
  }

  const server = new Server({ name: "rdyrct", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await handleTool(request.params.name, {
        env: c.env,
        ctx: c.executionCtx,
        db: c.var.db,
        user,
        authorization,
        // SAFETY: MCP tool call arguments arrive as a JSON-RPC params object,
        // already parsed JSON; each tool's own v.parse validates its shape.
        rawArgs: request.params.arguments as JsonValue | undefined,
      });
    } catch (err) {
      // A tool failure is not a protocol error: the agent gets a readable
      // reason back (an over-cap quota, an ambiguous slug, a bad role) and
      // can explain it or retry, rather than the connection dying (#139
      // "an agent hitting the link cap should get an error it can explain").
      // Only HTTPException and createError() messages are app-authored and
      // safe to show as-is; anything else (a raw driver error, an
      // unexpected runtime exception) gets a fixed generic message instead
      // of leaking internal detail to the caller, and is logged server-side
      // so it is still visible.
      if (err instanceof HTTPException) return errorResult(err.message);
      if (EvlogError.isEvlogError(err)) return errorResult(err.message);
      log.error(err instanceof Error ? err : new Error(String(err)));
      return errorResult("That tool call failed.");
    }
  });

  const transport = new StreamableHTTPTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(c);
});
