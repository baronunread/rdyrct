import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createError, EvlogError } from "evlog";
import { and, eq } from "drizzle-orm";
import * as v from "valibot";
import type { JsonValue, LinkStats, OrgStats } from "../../shared/types";
import type { CallToolResult, Implementation, Tool } from "@modelcontextprotocol/sdk/types.js";
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
// Unrestricted: this app is never reachable by a real inbound request (its
// own paths carry no /api prefix at all), only by dispatch() below, so an
// OAuth token authenticates here exactly as it did at the public /api/mcp
// route that already checked it once (#242).
// A refusal keeps its words. Hono's default answers an HTTPException as plain
// text, which ok() below cannot read, so the agent got "Request failed with
// status 422" instead of "another link shortener". Anything else is rethrown
// to the tool call's own catch, which logs it and answers generically.
internal.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ message: err.message }, err.status);
  if (EvlogError.isEvlogError(err))
    // SAFETY: every createError() call site passes a real HTTP status
    // (400-599); the fallback covers one that left it unset.
    return c.json({ message: err.message }, (err.status ?? 500) as ContentfulStatusCode);
  throw err;
});
internal.use("*", withSession());
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
  url: string;
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
          url: v.string(),
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

/** Every tool but generate_qr_code takes this, and resolveOrg() explains it. */
const ORG_ID_PROPERTY = {
  type: "string",
  description:
    "The organization's id. Leave it out when the person belongs to one organization. With more than one, the tool answers with each one's name and id; pass the id they mean.",
};

/** How a tool finds a link, for update_link and delete_link (findOneLink). */
const FIND_BY_SLUG = {
  type: "string",
  description:
    'The link\'s slug: the part of the short link after the domain, "promo" in a short link ending /promo. list_links returns the slug of each link it finds.',
};

/**
 * Hints for the client, read off each handler below:
 * - readOnlyHint: the handler only reads (GET routes, orgPlan, or no I/O).
 * - destructiveHint: it deletes or overwrites something the person cannot
 *   get back through these tools.
 * - idempotentHint: a second call with the same arguments changes nothing
 *   further.
 * - openWorldHint: it reaches past the organization's own data (an email to
 *   an outside address).
 */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const TOOLS: Tool[] = [
  {
    name: "create_link",
    title: "Create a short link",
    description:
      "Shorten a URL into a new short link. Returns the link as JSON: its short URL (url), slug, destination, title and domain, plus the organization's count of links in use (quotaUsage). Needs the member role or higher. Refuses when the organization already has a link to the same destination on the same domain, or is at its plan's link limit. Some destinations are refused (blocked hosts, other link shorteners, rdyrct short links), and the error says which. On a free plan, one that looks like a scam is saved on hold and does not redirect until rdyrct reviews it.",
    inputSchema: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: "The http(s) URL the short link sends visitors to.",
        },
        slug: {
          type: "string",
          description:
            "A slug of the person's choosing. Only allowed with domain: links on the shared domain always get a random slug. Leave it out for a random one.",
        },
        title: {
          type: "string",
          description: "A label for the link, shown in the person's link list.",
        },
        domain: {
          type: "string",
          description:
            'The hostname of one of the organization\'s own active domains, such as "go.example.com". Leave it out to use the shared domain.',
        },
        org_id: ORG_ID_PROPERTY,
      },
      required: ["destination"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "update_link",
    title: "Update a short link",
    description:
      "Point an existing link at a new destination, or change its title. The slug and short URL stay the same, so anyone who already has the link reaches the new destination; the old destination is not kept. Find the link by slug, or by its current destination. Needs the member role or higher. Returns the updated link as JSON. Some destinations are refused (blocked hosts, other link shorteners, rdyrct short links), and the error says which. On a free plan, one that looks like a scam is saved on hold and does not redirect until rdyrct reviews it.",
    inputSchema: {
      type: "object",
      properties: {
        slug: FIND_BY_SLUG,
        destination: {
          type: "string",
          description:
            "Part or all of the link's current destination URL, to find it by when the slug is not known. Must match one link only.",
        },
        new_destination: {
          type: "string",
          description: "The http(s) URL the link should send visitors to from now on.",
        },
        title: {
          type: "string",
          description: "The link's new label. An empty string clears it.",
        },
        org_id: ORG_ID_PROPERTY,
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "delete_link",
    title: "Delete a short link",
    description:
      "Delete a link for good: its short URL stops working and its click history goes with it. This cannot be undone. Find the link by slug, or by its destination. Needs the member role or higher. Returns the deleted link's slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: FIND_BY_SLUG,
        destination: {
          type: "string",
          description:
            "Part or all of the link's destination URL, to find it by when the slug is not known. Must match one link only.",
        },
        org_id: ORG_ID_PROPERTY,
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "list_links",
    title: "Find short links",
    description:
      "Search an organization's links. Returns a JSON array of up to 10 links, each with its id, slug, domain (null for the shared domain), short URL, destination, title and click count.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Text to match against each link's slug, destination and title. Leave it out to list the newest links.",
        },
        org_id: ORG_ID_PROPERTY,
      },
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_link_stats",
    title: "Get a link's clicks",
    description:
      "How many clicks one link has had and where they came from, over the longest period the organization's plan keeps. Returns JSON: the link's slug, domain, short URL, destination and title, total clicks, clicks in the last 7 days, the time of the last click, and click counts by country, referrer and device.",
    inputSchema: {
      type: "object",
      properties: {
        slug: FIND_BY_SLUG,
        domain: {
          type: "string",
          description:
            'The hostname of the custom domain the link is on, such as "go.example.com". Needed only when the same slug is on more than one domain; left out, the link on the shared domain comes first.',
        },
        org_id: ORG_ID_PROPERTY,
      },
      required: ["slug"],
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_org_stats",
    title: "Get an organization's clicks",
    description:
      "An organization's links overall. Returns JSON: clicks in the period (totalClicks), the number of links, clicks in the last 7 days, the most-clicked links in the period, and links with no clicks in the last 30 days.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 1,
          maximum: 365,
          description:
            "How many days back to count clicks and rank links. Leave it out for the longest period the organization's plan keeps; a longer one is cut to that.",
        },
        org_id: ORG_ID_PROPERTY,
      },
    },
    annotations: READ_ONLY,
  },
  {
    name: "get_plan_usage",
    title: "Get plan usage",
    description:
      'How many links the organization\'s plan allows and how many it uses. Returns JSON: the plan ("free", "hobby" or "pro", or "unlimited" on a copy that runs without billing), links allowed, links used and links left.',
    inputSchema: { type: "object", properties: { org_id: ORG_ID_PROPERTY } },
    annotations: READ_ONLY,
  },
  {
    name: "invite_member",
    title: "Invite a member",
    description:
      "Invite someone to the organization: emails them a link to join, which lasts 7 days. Needs the admin role or higher, and a free seat on the plan. Asking again for an address that already has an open invite sends no second email; it renews that invite with the role given. Returns JSON: the invite, any address the email failed to reach (failed), and any address that already had an open invite (reused).",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "The email address to send the invite to." },
        role: {
          type: "string",
          enum: ["viewer", "member", "admin"],
          default: "member",
          description:
            "What the new member may do: a viewer only reads, a member also makes and changes links, an admin also manages members.",
        },
        org_id: ORG_ID_PROPERTY,
      },
      required: ["email"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "generate_qr_code",
    title: "Make a QR code",
    description:
      "Make a QR code for any http(s) URL, such as a short link's url. Changes nothing in any organization. Returns a 512 by 512 PNG image.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          maxLength: 2048,
          description: "The http(s) URL the QR code opens.",
        },
      },
      required: ["url"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

/* ---------------- server info (the initialize handshake) ---------------- */

/** How an agent should use the tools, sent once in the initialize reply. */
const SERVER_INSTRUCTIONS = [
  "rdyrct makes short links, counts their clicks, and makes QR codes.",
  "Every tool but generate_qr_code acts on one organization. Leave org_id out when the person belongs to one; if they belong to more, the tool answers with each one's name and id, and you call it again with the id they mean.",
  'A slug is the part of a short link after the domain: in a short link ending /promo, the slug is "promo". Find a link by its slug, or by its destination when the person names the page it points to. list_links returns both.',
  "Links on the shared domain get a random slug. A chosen slug needs one of the organization's own domains (the domain argument).",
  "A tool refuses what the person's role or plan does not allow, and says why. Pass that on rather than retrying.",
].join("\n");

/** The server's own description of itself. Its URLs come from APP_URL, so a
 * self-hosted copy points at itself, not rdyrct.com. Both icons are in
 * public/, which a self-hosted build keeps (scripts/self-host-files.ts). */
function serverInfo(env: Env): Implementation {
  return {
    name: "rdyrct",
    version: "1.0.0",
    title: "rdyrct",
    description:
      "Make and change short links, read their click stats, check plan limits, invite teammates, and make QR codes.",
    websiteUrl: env.APP_URL,
    icons: [
      { src: `${env.APP_URL}/connector-icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
      { src: `${env.APP_URL}/connector-icon.png`, mimeType: "image/png", sizes: ["512x512"] },
    ],
  };
}

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

/** What get_link_stats' description promises: clicks and where they came
 * from. The chart data LinkStats also carries (a year of daily series,
 * deltas, rangeDays) is for the dashboard, not this tool. */
type LinkStatsSummary = Pick<
  LinkStats,
  | "slug"
  | "domain"
  | "url"
  | "destination"
  | "title"
  | "totalClicks"
  | "clicks7d"
  | "lastClick"
  | "countries"
  | "referrers"
  | "devices"
>;

/** What get_org_stats' description promises: total/recent clicks, top
 * links, dead links. Same trim as LinkStatsSummary above. */
type OrgStatsSummary = Pick<
  OrgStats,
  "totalClicks" | "totalLinks" | "clicks7d" | "topLinks" | "deadLinks"
>;

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
  // SAFETY: dispatched to our own /links/stats route, whose body is a
  // LinkStats; the round trip narrows it the same way listLinksTool's does
  // above, and turns the trimmed object below back into a JsonValue.
  // eslint-disable-next-line react-doctor/no-json-parse-stringify-clone
  const s = JSON.parse(JSON.stringify(stats)) as LinkStats;
  // The dashboard's chart data (a year of daily series, deltas, rangeDays)
  // has no use here: the tool promises clicks and where they came from, and
  // the full DTO was ~370 lines of mostly zeros for a fresh link.
  const summary: LinkStatsSummary = {
    slug: s.slug,
    domain: s.domain,
    url: s.url,
    destination: s.destination,
    title: s.title,
    totalClicks: s.totalClicks,
    clicks7d: s.clicks7d,
    lastClick: s.lastClick,
    countries: s.countries,
    referrers: s.referrers,
    devices: s.devices,
  };
  // eslint-disable-next-line react-doctor/no-json-parse-stringify-clone
  return textResult(JSON.parse(JSON.stringify(summary)));
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
  // SAFETY: dispatched to our own /stats route, whose body is an OrgStats;
  // same round trip as getLinkStats above.
  // eslint-disable-next-line react-doctor/no-json-parse-stringify-clone
  const s = JSON.parse(JSON.stringify(stats)) as OrgStats;
  // Same trim as getLinkStats: the daily/hourly series, UTM breakdowns and
  // heatmap are dashboard chart data the tool's description never promised.
  const summary: OrgStatsSummary = {
    totalClicks: s.totalClicks,
    totalLinks: s.totalLinks,
    clicks7d: s.clicks7d,
    topLinks: s.topLinks,
    deadLinks: s.deadLinks,
  };
  // eslint-disable-next-line react-doctor/no-json-parse-stringify-clone
  return textResult(JSON.parse(JSON.stringify(summary)));
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

/**
 * pngjs's defaults cost ~1.7s of CPU per 512px code in workerd: it tries all
 * five PNG filters on every one of the 512 RGBA scanlines to pick the best,
 * then deflates with the run-length strategy. A QR code needs no search: its
 * rows repeat in blocks of one module, so the "Up" filter turns every
 * repeated row into zeros and plain deflate takes the rest. ~145ms, and the
 * file comes out smaller (2.8 KB against 3.6 KB for a short URL).
 */
const QR_PNG_OPTS = { filterType: 2, deflateStrategy: 0 };

async function generateQrCode(t: ToolCtx): Promise<CallToolResult> {
  const parsed = parseArgs(qrArgs, t.rawArgs);
  if (!parsed.ok) return parsed.result;
  const args = parsed.value;
  if (!isValidHttpUrl(args.url)) return errorResult("That is not a valid http(s) URL.");
  const QRCode = await import("qrcode");
  const png = new Uint8Array(
    await QRCode.toBuffer(args.url, { width: 512, margin: 2, rendererOpts: QR_PNG_OPTS }),
  );
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

  // The MCP SDK (and the ajv and zod it brings) loads here, on the one route
  // that speaks MCP, rather than on every cold start of the Worker.
  const [
    { Server },
    { CallToolRequestSchema, ListToolsRequestSchema },
    { StreamableHTTPTransport },
  ] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/index.js"),
    import("@modelcontextprotocol/sdk/types.js"),
    import("@hono/mcp"),
  ]);
  const server = new Server(serverInfo(c.env), {
    capabilities: { tools: {} },
    instructions: SERVER_INSTRUCTIONS,
  });
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
