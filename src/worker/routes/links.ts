import { Hono, type Context } from "hono";
import { nonEmpty } from "../../shared/lookup";
import type { JsonValue } from "../../shared/types";
import { optionalText, parseBody, parseOptionalBody } from "../schemas";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { orgDeleting, requireOrgRole } from "../org-role";
import { deleteQrLogoMsg, enqueueStorage, syncLinkMsg } from "../storage";
import { reconcileAfterDelete } from "../reconcile";
import {
  orgPlan,
  countActiveAddresses,
  guardedTempAliasStatement,
  insertAddressWithinLimit,
  insertLinkWithinLimit,
  notDeletingSql,
  toD1Statement,
  keepAddressForeverWithinLimit,
} from "../plan";
import {
  uid,
  randomSlug,
  SLUG_RE,
  RESERVED_SLUGS,
  isValidHttpUrl,
  normalizeUrl,
  resolveUtm,
  stripUtmParams,
  validateQrFields,
  changesQr,
  ALIAS_TTL_MS,
  linkUrl,
} from "../util";
import { jsonBodyLimit } from "../body-limit";
import { assertNotShortener } from "../abuse";
import { assertDestinationAllowed, holdIfSuspicious } from "../abuse-hold";
import { checkLinkDestination } from "../destination-check";
import { orgLinkWarning } from "../link-warning";
import { claimAnonLink } from "./shorten";
import { allocateSharedSlug } from "../shared-slugs";
import {
  attentionNote,
  cursorValueOf,
  linkFacets,
  linkPageQuery,
  readLinkPageParams,
  sparkLines,
  SPARK_SHOWN,
  sparkSince,
  takePage,
  type Page,
} from "../links-page";
import { clicksForLink, linkClicksTotal, sparkRows } from "../rollups";
import type {
  AddressDTO,
  LinkDTO,
  LinkInput,
  LinkListItem,
  OrgPlan,
  PlanLimits,
  QrOverrides,
  QuotaUsage,
  TopEntry,
} from "@/shared/types";

const RECENT_CLICKS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Active aliases a link may hold at once: caps how much of the org's link quota one link can soak up
// through kept-forever aliases.
const MAX_ALIASES_PER_LINK = 5;

export const linkRoutes = new Hono<AppEnv>();
linkRoutes.use("*", jsonBodyLimit());

function validateSlug(slug: string | undefined): void {
  if (slug === undefined || slug === "") return;
  if (!SLUG_RE.test(slug))
    throw new HTTPException(400, {
      message: "Slug may only contain letters, numbers, - and _ (max 64)",
      cause: { code: "bad_slug" },
    });
  if (RESERVED_SLUGS.has(slug.toLowerCase()))
    throw new HTTPException(400, {
      message: "That slug is reserved",
      cause: { code: "reserved_slug" },
    });
}

function validateInput(body: LinkInput, orgId: string, partial = false) {
  if ((!partial || body.destination !== undefined) && body.destination) {
    body.destination = normalizeUrl(body.destination.trim());
    if (!isValidHttpUrl(body.destination))
      throw new HTTPException(400, {
        message: "Destination must be a valid http(s) URL",
        cause: { code: "bad_destination" },
      });
    assertNotShortener(body.destination);
  }
  validateSlug(body.slug);
  validateQrFields(body, orgId);
}

const clickCount = linkClicksTotal.as("clicks");

// Literal `links.id`: the drizzle column renders an unqualified "id" that SQLite resolves against the subquery's table.
const addressCount = sql<number>`(
  select count(*) from link_addresses
  where link_addresses.link_id = links.id and link_addresses.retired_at is null
)`.as("addressCount");

function toDTO(
  env: Env,
  row: typeof schema.links.$inferSelect,
  clicks: number,
  domain: string | null,
  addressCount: number,
): LinkDTO {
  return {
    id: row.id,
    domainId: row.domainId,
    domain,
    slug: row.slug,
    url: linkUrl(env, domain, row.slug),
    destination: row.destination,
    title: row.title,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    utmTerm: row.utmTerm,
    utmContent: row.utmContent,
    qrLogo: row.qrLogo,
    qrStyle: row.qrStyle,
    qrColor: row.qrColor,
    qrCorner: row.qrCorner,
    qrBg: row.qrBg,
    qrEyeColor: row.qrEyeColor,
    qrLogoSize: row.qrLogoSize,
    createdAt: row.createdAt,
    clicks,
    addressCount,
    createdBy: row.createdBy,
    suspendedAt: row.suspendedAt,
  };
}

async function linkToDTO(
  env: Env,
  db: DB,
  orgId: string,
  row: typeof schema.links.$inferSelect,
): Promise<LinkDTO> {
  const [hostname, clicks, addressCount] = await Promise.all([
    domainHostname(db, orgId, row.domainId),
    clicksForLink(db, row.id),
    countAddressesForLink(db, row.id),
  ]);
  return toDTO(env, row, clicks, hostname, addressCount);
}

async function linkWithQuota(
  env: Env,
  db: DB,
  orgId: string,
  row: typeof schema.links.$inferSelect,
) {
  const [dto, quota] = await Promise.all([
    linkToDTO(env, db, orgId, row),
    quotaUsageFields(db, orgId),
  ]);
  return { ...dto, ...quota };
}

async function insertAddressAndRespond(
  env: Env,
  db: DB,
  orgId: string,
  link: typeof schema.links.$inferSelect,
  address: typeof schema.linkAddresses.$inferInsert,
  hostname: string | null,
  status: 200 | 201,
  linkLimit: number,
) {
  // Atomic: both caps are re-checked at write time inside one D1 statement (#18). The per-link one too:
  // assertAliasQuota reads before the insert, so two merges arriving together both took the fifth alias.
  // MAX_ALIASES_PER_LINK counts aliases; the statement counts addresses, the primary included.
  const inserted = await insertAddressWithinLimit(
    env,
    address,
    linkLimit,
    MAX_ALIASES_PER_LINK + 1,
  );
  if (!inserted) await refuseAddressInsert(db, orgId);
  await enqueueStorage(env, [syncLinkMsg(address.slug, hostname)]);
  return { dto: await linkWithQuota(env, db, orgId, link), status } as const;
}

// The insert has two possible refusals and only one is about money: telling an org being deleted to
// upgrade sells a fix for a problem they do not have (#52). Costs one read, on an already failed path.
async function refuseAddressInsert(db: DB, orgId: string): Promise<never> {
  if (await orgDeleting(db, orgId))
    throw new HTTPException(409, { message: "Organization is being deleted" });
  throw new HTTPException(402, {
    message: "Upgrade your plan to create more links",
    cause: { code: "link_limit" },
  });
}

async function countAddressesForLink(db: DB, linkId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.linkAddresses)
    .where(and(eq(schema.linkAddresses.linkId, linkId), isNull(schema.linkAddresses.retiredAt)));
  return rows[0]?.n ?? 0;
}

async function assertAliasQuota(db: DB, linkId: string): Promise<void> {
  const activeAliases = (await countAddressesForLink(db, linkId)) - 1; // exclude primary
  if (activeAliases >= MAX_ALIASES_PER_LINK)
    throw new HTTPException(409, {
      message: `This link already has ${MAX_ALIASES_PER_LINK} aliases, the most allowed. Remove one before adding another.`,
      cause: { code: "alias_limit_reached" },
    });
}

async function findLink(db: DB, orgId: string, linkId: string) {
  const rows = await db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.id, linkId), eq(schema.links.orgId, orgId)));
  const link = rows[0];
  if (!link) throw new HTTPException(404, { message: "Link not found" });
  return link;
}

/** 409 with a machine-readable code so the editor can point at the slug field. */
function slugConflict(slug: string, sharedDomain: boolean): HTTPException {
  return new HTTPException(409, {
    message: sharedDomain
      ? `"/${slug}" is already taken on the shared domain.`
      : `"/${slug}" is already taken on this domain.`,
    cause: { code: "slug_taken" },
  });
}

async function findAddress(db: DB, orgId: string, linkId: string, addressId: string) {
  const rows = await db
    .select()
    .from(schema.linkAddresses)
    .where(
      and(
        eq(schema.linkAddresses.id, addressId),
        eq(schema.linkAddresses.linkId, linkId),
        eq(schema.linkAddresses.orgId, orgId),
      ),
    );
  const address = rows[0];
  if (!address) throw new HTTPException(404, { message: "Address not found" });
  return address;
}

async function linkFromRequest(c: Context<AppEnv>) {
  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  return { db, orgId, link: await findLink(db, orgId, c.req.param("linkId")!) };
}

async function quotaUsageFields(db: DB, orgId: string): Promise<QuotaUsage> {
  return { quotaUsage: await countActiveAddresses(db, orgId), quotaUsageAt: Date.now() };
}

async function okWithQuota(db: DB, orgId: string) {
  return { ok: true as const, ...(await quotaUsageFields(db, orgId)) };
}

async function findLinkAndAddress(c: Context<AppEnv>) {
  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  const linkId = c.req.param("linkId")!;
  const [link, address] = await Promise.all([
    findLink(db, orgId, linkId),
    findAddress(db, orgId, linkId, c.req.param("addressId")!),
  ]);
  return { db, orgId, link, address };
}

export function newAddressRow(
  linkId: string,
  orgId: string,
  domainId: string | null,
  slug: string,
  kind: "primary" | "temp_alias" | "permanent_alias",
  creationReason: "created" | "renamed" | "promoted" | "same_destination_merge",
  expiresAt: number | null = null,
): typeof schema.linkAddresses.$inferInsert {
  return {
    id: uid(),
    linkId,
    orgId,
    domainId,
    slug,
    kind,
    creationReason,
    expiresAt,
    retiredAt: null,
    createdAt: Date.now(),
  };
}

async function addressClickStats(
  db: DB,
  addressId: string,
): Promise<{ recentClicks: number; lastUse: number | null; referrers: TopEntry[] }> {
  const cutoff = Date.now() - RECENT_CLICKS_WINDOW_MS;
  const recent = sql`${schema.clicks.addressId} = ${addressId} and ${schema.clicks.ts} >= ${cutoff}`;
  const [summary, referrers] = await Promise.all([
    db
      .select({
        recentClicks: sql<number>`count(*)`,
        lastUse: sql<number | null>`max(${schema.clicks.ts})`,
      })
      .from(schema.clicks)
      .where(recent),
    db
      .select({ key: schema.clicks.referrer, clicks: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(sql`${recent} and ${schema.clicks.referrer} != ''`)
      .groupBy(schema.clicks.referrer)
      .orderBy(desc(sql`count(*)`))
      .limit(5),
  ]);
  return {
    recentClicks: summary[0]?.recentClicks ?? 0,
    lastUse: summary[0]?.lastUse ?? null,
    referrers,
  };
}

function addressToDTO(
  env: Env,
  row: typeof schema.linkAddresses.$inferSelect,
  hostname: string | null,
  stats: { recentClicks: number; lastUse: number | null; referrers: TopEntry[] },
): AddressDTO {
  return {
    id: row.id,
    domainId: row.domainId,
    domain: hostname,
    slug: row.slug,
    url: linkUrl(env, hostname, row.slug),
    kind: row.kind,
    creationReason: row.creationReason,
    expiresAt: row.expiresAt,
    retiredAt: row.retiredAt,
    createdAt: row.createdAt,
    recentClicks: stats.recentClicks,
    lastUse: stats.lastUse,
    referrers: stats.referrers,
  };
}

// Different UTM values never match (they are part of the tuple). Usually one row, but "create separate
// link anyway" can leave several, so the match dialog offers all. Restricted to `domainId`: an alias
// lives only on its link's domain (#38).
async function findSameDestinationLinks(
  db: DB,
  orgId: string,
  destination: string,
  utm: ReturnType<typeof resolveUtm>,
  domainId: string | null,
): Promise<(typeof schema.links.$inferSelect)[]> {
  return db
    .select()
    .from(schema.links)
    .where(
      and(
        eq(schema.links.orgId, orgId),
        eq(schema.links.destination, destination),
        eq(schema.links.utmSource, utm.utmSource),
        eq(schema.links.utmMedium, utm.utmMedium),
        eq(schema.links.utmCampaign, utm.utmCampaign),
        eq(schema.links.utmTerm, utm.utmTerm),
        eq(schema.links.utmContent, utm.utmContent),
        domainId === null ? isNull(schema.links.domainId) : eq(schema.links.domainId, domainId),
      ),
    )
    .orderBy(desc(schema.links.createdAt));
}

// A new shared slug never comes here (allocateSharedSlug). Uniqueness lives on the active address set: a slug
// a link moved away from stays reserved by its alias row. excludeLinkId excludes all of that link's rows,
// so promoting its own alias never trips over its other rows.
async function slugTaken(
  db: DB,
  slug: string,
  domainId: string | null,
  excludeLinkId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ linkId: schema.linkAddresses.linkId })
    .from(schema.linkAddresses)
    .where(
      and(
        eq(schema.linkAddresses.slug, slug),
        isNull(schema.linkAddresses.retiredAt),
        sql`ifnull(${schema.linkAddresses.domainId}, '') = ${domainId ?? ""}`,
      ),
    );
  return rows.some((r) => r.linkId !== excludeLinkId);
}

async function ownsSlugAsAlias(
  db: DB,
  linkId: string,
  slug: string,
  domainId: string | null,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.linkAddresses.id })
    .from(schema.linkAddresses)
    .where(
      and(
        eq(schema.linkAddresses.linkId, linkId),
        eq(schema.linkAddresses.slug, slug),
        isNull(schema.linkAddresses.retiredAt),
        sql`ifnull(${schema.linkAddresses.domainId}, '') = ${domainId ?? ""}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function findDomain(db: DB, orgId: string, domainId: string) {
  const rows = await db
    .select({ hostname: schema.domains.hostname, lockedAt: schema.domains.lockedAt })
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.orgId, orgId)));
  if (!rows[0]) throw new HTTPException(400, { message: "Unknown domain for this org" });
  return rows[0];
}

// A locked domain answers too: everything touching an address already on it has to work through the
// grace period, and refusing here once left D1 written and KV not (#485). Only a new address is
// refused: see `newAddressHostname`.
async function domainHostname(
  db: DB,
  orgId: string,
  domainId: string | null,
): Promise<string | null> {
  return domainId ? (await findDomain(db, orgId, domainId)).hostname : null;
}

async function newAddressHostname(
  db: DB,
  orgId: string,
  domainId: string | null,
): Promise<string | null> {
  if (!domainId) return null;
  const domain = await findDomain(db, orgId, domainId);
  if (domain.lockedAt !== null)
    throw new HTTPException(402, {
      message: "That domain is locked: upgrade to use it again",
      cause: { code: "domain_locked" },
    });
  return domain.hostname;
}

function assertLinkQuota(count: number, plan: OrgPlan, limits: PlanLimits): void {
  if (count >= limits.links)
    throw new HTTPException(402, {
      message:
        plan === "free"
          ? `The free plan allows ${limits.links} links, upgrade to a paid plan for more`
          : `This plan allows at most ${limits.links} links`,
    });
}

function assertQrAllowed(
  body: LinkInput,
  limits: PlanLimits,
  existing: Partial<QrOverrides> | null,
): void {
  if (changesQr(body, existing) && !limits.qrCustom)
    throw new HTTPException(402, {
      message: "Changing how QR codes look needs a paid plan",
      cause: { code: "qr_locked" },
    });
}

// Null on the shared domain: allocateSharedSlug issues each slug for good, so the caller draws it
// (issueSlug) only once nothing else can refuse, or every refused create would use one up.
async function resolveNewSlug(
  db: DB,
  requested: string,
  domainId: string | null,
): Promise<string | null> {
  if (requested && domainId === null)
    throw new HTTPException(400, {
      message:
        "Links on the shared domain get random slugs: connect a custom domain (paid plans) to choose your own",
      cause: { code: "slug_locked" },
    });
  if (domainId === null) return null;
  if (requested) {
    if (await slugTaken(db, requested, domainId)) throw slugConflict(requested, false);
    return requested;
  }
  for (let i = 0; i < 5; i++) {
    const candidate = randomSlug();
    if (!(await slugTaken(db, candidate, domainId))) return candidate;
  }
  throw new HTTPException(500, { message: "Could not allocate slug" });
}

const issueSlug = (db: DB, resolved: string | null) => resolved ?? allocateSharedSlug(db);

async function resolveRenamedSlug(
  db: DB,
  existing: typeof schema.links.$inferSelect,
  requested: string,
  domainId: string | null,
): Promise<string> {
  const newSlug = requested || existing.slug;
  if (newSlug !== existing.slug && domainId === null)
    throw new HTTPException(400, {
      message:
        "Links on the shared domain keep their random slug: move the link to a custom domain to choose one",
      cause: { code: "slug_locked" },
    });
  const moved = newSlug !== existing.slug || domainId !== existing.domainId;
  if (moved && (await ownsSlugAsAlias(db, existing.id, newSlug, domainId)))
    throw new HTTPException(409, {
      message:
        "That address is already an alias of this link: make it primary instead of renaming.",
      cause: { code: "slug_is_own_alias" },
    });
  if (moved && (await slugTaken(db, newSlug, domainId, existing.id)))
    throw slugConflict(newSlug, domainId === null);
  return newSlug;
}

// Cursor-paged, searched, filtered and sorted here: see links-page.ts for why the browser cannot.
linkRoutes.get("/", requireOrgRole("viewer"), async (c) => {
  const orgId = c.req.param("orgId")!;
  const now = Date.now();
  const params = readLinkPageParams(new URL(c.req.url));
  const query = linkPageQuery(orgId, params, now);
  // Absent when mcp.ts dispatches here: that inner app has no evlog middleware.
  const log = c.get("log");
  log?.set({ orgId, linkList: { sort: params.sort, filter: params.filter } });

  const rows = await c.var.db
    .select({
      link: schema.links,
      clicks: clickCount,
      domain: schema.domains.hostname,
      addressCount,
    })
    .from(schema.links)
    .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(query.where)
    .orderBy(query.orderBy)
    .limit(query.limit);

  const page = takePage(
    rows.map((r) => toDTO(c.env, r.link, r.clicks, r.domain, r.addressCount)),
    params,
    cursorValueOf(params.sort),
  );
  const warnedAt = new Map(rows.map((r) => [r.link.id, r.link.warnedAt]));
  const sparkOf = sparkLines(
    page.items.length
      ? await sparkRows(
          c.var.db,
          orgId,
          page.items.map((l) => l.id),
          sparkSince(now),
        )
      : [],
    now,
  );
  return c.json({
    nextCursor: page.nextCursor,
    items: page.items.map((link): LinkListItem => {
      const spark = sparkOf(link.id);
      const note = { warnedAt: warnedAt.get(link.id) ?? null, createdAt: link.createdAt };
      return {
        ...link,
        spark: spark.slice(-SPARK_SHOWN),
        attention: attentionNote(note, spark, link.clicks, now),
      };
    }),
  } satisfies Page<LinkListItem>);
});

linkRoutes.get("/facets", requireOrgRole("viewer"), async (c) => {
  const orgId = c.req.param("orgId")!;
  const facets = await linkFacets(c.var.db, orgId);
  c.get("log")?.set({ orgId, linkFacets: facets });
  return c.json(facets);
});

// Distinct from the list's count: a link plus its kept-forever aliases can use more than one unit of the
// plan's `links` cap (a rename's 48h temp_alias never does, see countActiveAddresses).
// Claiming is best-effort: a failed claim should cost a 24-hour link, not the signup.
const claimBodySchema = v.object({ claimToken: optionalText });

linkRoutes.post("/claim", requireOrgRole("member"), async (c) => {
  const { claimToken } = parseOptionalBody(
    claimBodySchema,
    await c.req.json<JsonValue>().catch(() => ({})),
  );
  if (!claimToken) throw new HTTPException(400, { message: "Nothing to claim" });

  const link = await claimAnonLink(c.env, c.req.param("orgId")!, c.var.user!.id, claimToken);
  if (!link) throw new HTTPException(404, { message: "That link is no longer available" });
  // Absent when mcp.ts dispatches here: that inner app has no evlog middleware.
  const log = c.get("log");
  log?.set({ orgId: c.req.param("orgId"), linkId: link.id });
  return c.json(await linkToDTO(c.env, c.var.db, c.req.param("orgId")!, link), 201);
});

linkRoutes.get("/quota-usage", requireOrgRole("viewer"), async (c) => {
  const { quotaUsage, quotaUsageAt } = await quotaUsageFields(c.var.db, c.req.param("orgId")!);
  // Absent when mcp.ts dispatches here: that inner app has no evlog middleware.
  const log = c.get("log");
  log?.set({ orgId: c.req.param("orgId"), quotaUsage });
  return c.json({ count: quotaUsage, at: quotaUsageAt });
});

export function newLinkRow(
  orgId: string,
  domainId: string | null,
  slug: string,
  body: LinkInput,
  utm: ReturnType<typeof resolveUtm>,
  createdBy: string | null,
): typeof schema.links.$inferSelect {
  return {
    id: uid(),
    orgId,
    domainId,
    slug,
    destination: body.destination,
    title: body.title?.trim() ?? "",
    utmSource: utm.utmSource,
    utmMedium: utm.utmMedium,
    utmCampaign: utm.utmCampaign,
    utmTerm: utm.utmTerm,
    utmContent: utm.utmContent,
    qrLogo: body.qrLogo ?? "",
    qrStyle: body.qrStyle ?? "",
    qrColor: body.qrColor ?? "",
    qrCorner: body.qrCorner ?? "",
    qrBg: body.qrBg ?? "",
    qrEyeColor: body.qrEyeColor ?? "",
    qrLogoSize: body.qrLogoSize ?? null,
    createdBy,
    createdAt: Date.now(),
    // Null is not "clean", it is "nobody has looked yet" (#68): it also puts this row first in the cron's queue.
    riskScore: null,
    riskReasons: null,
    riskCheckedAt: null,
    riskProvider: null,
    suspendedAt: null,
    suspendedBy: null,
    suspendReason: null,
    warnedAt: null,
    warnReason: null,
    webRiskCheckedAt: null,
  };
}

// Its own function: the same-domain and target-still-matches checks are half the branches in create and
// have nothing to do with creating a link.
async function mergeAddressIntoLink(
  c: Context<AppEnv>,
  args: {
    orgId: string;
    linkId: string;
    domainId: string | null;
    slug: string;
    hostname: string | null;
    destination: string;
    utm: ReturnType<typeof resolveUtm>;
    activeCount: number;
    plan: OrgPlan;
    limits: PlanLimits;
  },
) {
  const db = c.var.db;
  const target = await findLink(db, args.orgId, args.linkId);
  // The match list is domain-filtered, but re-check in case the caller sent a stale mergeIntoLinkId (#38).
  if (target.domainId !== args.domainId)
    throw new HTTPException(400, {
      message: "An address can only be added to a link on the same domain",
    });
  if (target.destination !== args.destination || !sameUtm(target, args.utm))
    throw new HTTPException(409, {
      message: "That link no longer has this destination. Review the link and try again.",
      cause: { code: "merge_target_changed" },
    });

  assertLinkQuota(args.activeCount, args.plan, args.limits);
  await assertAliasQuota(db, target.id);
  const address = newAddressRow(
    target.id,
    args.orgId,
    args.domainId,
    args.slug,
    "permanent_alias",
    "same_destination_merge",
  );
  return insertAddressAndRespond(
    c.env,
    db,
    args.orgId,
    target,
    address,
    args.hostname,
    200,
    args.limits.links,
  );
}

function sameUtm(
  link: {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
  },
  utm: ReturnType<typeof resolveUtm>,
) {
  return (
    link.utmSource === utm.utmSource &&
    link.utmMedium === utm.utmMedium &&
    link.utmCampaign === utm.utmCampaign &&
    link.utmTerm === utm.utmTerm &&
    link.utmContent === utm.utmContent
  );
}

linkRoutes.post("/", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<LinkInput>();
  const orgId = c.req.param("orgId")!;
  validateInput(body, orgId);
  const db = c.var.db;
  await assertDestinationAllowed(c.env, db, body.destination);

  const [{ plan, limits }, activeCount] = await Promise.all([
    orgPlan(db, orgId),
    countActiveAddresses(db, orgId),
  ]);
  assertQrAllowed(body, limits, null);

  const domainId = body.domainId ?? null;
  const [hostname, resolvedSlug] = await Promise.all([
    newAddressHostname(db, orgId, domainId),
    resolveNewSlug(db, body.slug?.trim() || "", domainId),
  ]);

  // UTM params in the destination move into the columns so analytics group-bys see them, then are stripped
  // from the destination so the columns are the only place UTM data lives.
  const utm = resolveUtm(body.destination, body);
  body.destination = stripUtmParams(body.destination);

  if (body.mergeIntoLinkId) {
    const { dto, status } = await mergeAddressIntoLink(c, {
      orgId,
      linkId: body.mergeIntoLinkId,
      domainId,
      slug: await issueSlug(db, resolvedSlug),
      hostname,
      destination: body.destination,
      utm,
      activeCount,
      plan,
      limits,
    });
    return c.json(dto, status);
  }

  if (!body.forceSeparateLink) {
    const matches = await findSameDestinationLinks(db, orgId, body.destination, utm, domainId);
    if (matches.length) {
      const matchedLinks = await Promise.all(
        matches.map((match) => linkToDTO(c.env, db, orgId, match)),
      );
      throw new HTTPException(409, {
        message:
          "This destination already belongs to a link. Add this address to the same link so its settings and analytics stay together.",
        cause: { code: "same_destination_match", matchedLinks },
      });
    }
  }

  assertLinkQuota(activeCount, plan, limits);
  const slug = await issueSlug(db, resolvedSlug);
  const link = newLinkRow(orgId, domainId, slug, body, utm, c.var.user!.id);
  // A scam-shaped destination is created on hold, before the insert so it never serves. Otherwise it is
  // born warned while the org is (#344), so a warned org cannot get round it with a fresh link.
  Object.assign(
    link,
    (await holdIfSuspicious(c.env, db, orgId, plan, link.destination)) ??
      (await orgLinkWarning(db, orgId)),
  );
  const address = newAddressRow(link.id, orgId, domainId, slug, "primary", "created");
  // Atomic: the link insert, the cap-guarded address insert and a compensating delete run in one D1 batch,
  // not from `activeCount` above (#18), so no link persists without its primary address and the rollback
  // cannot itself fail as a separate call.
  const inserted = await insertLinkWithinLimit(db, c.env, link, address, limits.links);
  if (!inserted) await refuseAddressInsert(db, orgId);
  await enqueueStorage(c.env, [syncLinkMsg(link.slug, hostname)]);
  // Score after the response (#68): nobody waits on it. Only a Web Risk hit acts (#341).
  c.executionCtx.waitUntil(checkLinkDestination(c.env, link));
  return c.json(
    { ...toDTO(c.env, link, 0, hostname, 1), ...(await quotaUsageFields(db, orgId)) },
    201,
  );
});

function mergedLinkUpdate(
  existing: typeof schema.links.$inferSelect,
  body: LinkInput,
  fields: {
    domainId: string | null;
    slug: string;
    destination: string;
    utm: ReturnType<typeof resolveUtm>;
  },
): typeof schema.links.$inferSelect {
  return {
    ...existing,
    domainId: fields.domainId,
    slug: fields.slug,
    destination: fields.destination,
    title: body.title?.trim() ?? existing.title,
    utmSource: fields.utm.utmSource,
    utmMedium: fields.utm.utmMedium,
    utmCampaign: fields.utm.utmCampaign,
    utmTerm: fields.utm.utmTerm,
    utmContent: fields.utm.utmContent,
    qrLogo: body.qrLogo ?? existing.qrLogo,
    qrStyle: body.qrStyle ?? existing.qrStyle,
    qrColor: body.qrColor ?? existing.qrColor,
    qrCorner: body.qrCorner ?? existing.qrCorner,
    qrBg: body.qrBg ?? existing.qrBg,
    qrEyeColor: body.qrEyeColor ?? existing.qrEyeColor,
    // `undefined`, not nullish: `null` is how the client clears the logo size, and `??` swallowed it. The
    // five fields above take "" for the same job.
    qrLogoSize: body.qrLogoSize !== undefined ? body.qrLogoSize : existing.qrLogoSize,
    ...riskAfterDestinationChange(existing, fields.destination),
  };
}

// Leaving the previous score until the re-scan lands would let a link swapped to a bad destination keep
// reading clean (#68). An unchanged destination keeps its verdict.
function riskAfterDestinationChange(
  existing: typeof schema.links.$inferSelect,
  destination: string,
) {
  if (destination === existing.destination) return {};
  // Web Risk's stamp too: it was for the old destination. Left in place, a lookup the new one never got
  // would keep the link out of the rescan for the week the stamp buys.
  return {
    riskScore: null,
    riskReasons: null,
    riskCheckedAt: null,
    riskProvider: null,
    webRiskCheckedAt: null,
  };
}

function renameSyncMessages(
  existing: typeof schema.links.$inferSelect,
  updated: typeof schema.links.$inferSelect,
  body: LinkInput,
  moved: boolean,
  hostname: string | null,
  oldHostname: string | null,
) {
  return [
    moved ? syncLinkMsg(existing.slug, oldHostname) : null,
    syncLinkMsg(updated.slug, hostname),
    body.qrLogo !== undefined && body.qrLogo !== existing.qrLogo
      ? deleteQrLogoMsg(existing.qrLogo)
      : null,
  ];
}

/** Every active address of a link, each with its own hostname. Queue messages are self-healing, so callers can resync the whole set. */
export async function activeAddressesOf(db: DB, linkId: string) {
  return db
    .select({
      slug: schema.linkAddresses.slug,
      hostname: schema.domains.hostname,
      kind: schema.linkAddresses.kind,
    })
    .from(schema.linkAddresses)
    .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
    .where(and(eq(schema.linkAddresses.linkId, linkId), isNull(schema.linkAddresses.retiredAt)));
}

async function guardChangedDestination(
  env: Env,
  db: DB,
  orgId: string,
  plan: OrgPlan,
  existing: typeof schema.links.$inferSelect,
  destination: string,
) {
  if (destination === existing.destination) return null;
  await assertDestinationAllowed(env, db, destination);
  return existing.suspendedAt ? null : holdIfSuspicious(env, db, orgId, plan, destination);
}

linkRoutes.patch("/:linkId", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<LinkInput>();
  const orgId = c.req.param("orgId")!;
  validateInput(body, orgId, true);
  const db = c.var.db;
  const [{ plan, limits }, existing] = await Promise.all([
    orgPlan(db, orgId),
    findLink(db, orgId, c.req.param("linkId")!),
  ]);

  // After the row is read: the plan gates a *change* to the styling, not styling returning unchanged.
  assertQrAllowed(body, limits, existing);

  const domainId = body.domainId !== undefined ? body.domainId : existing.domainId;
  // A link's domain is fixed after creation (#38): its aliases are bound to it, so moving the primary
  // would strand them. The editor greys the field out; this guards direct API calls.
  if (domainId !== existing.domainId)
    throw new HTTPException(400, {
      message: "A link's domain can't change. Create a new link on the other domain instead.",
    });
  const [hostname, oldHostname, newSlug, aliases] = await Promise.all([
    domainHostname(db, orgId, domainId),
    domainHostname(db, orgId, existing.domainId),
    resolveRenamedSlug(db, existing, body.slug?.trim() || "", domainId),
    activeAddressesOf(db, existing.id),
  ]);
  const moved = newSlug !== existing.slug || domainId !== existing.domainId;
  // Only a custom-domain address leaves a temporary alias behind: a shared-domain slug cannot be renamed
  // (resolveRenamedSlug), so such a link never moves.
  const createsAlias = moved && existing.domainId !== null;
  if (createsAlias) await assertAliasQuota(db, existing.id);

  const destination = body.destination ?? existing.destination;
  // Re-resolve against the final destination, then strip params out of it as on create. existing.destination
  // may still carry legacy embedded params (pre-migration), which this cleans up.
  const utm = resolveUtm(destination, body, existing);
  const cleanDestination = stripUtmParams(destination);

  const hold = await guardChangedDestination(c.env, db, orgId, plan, existing, cleanDestination);
  const updated = {
    ...mergedLinkUpdate(existing, body, {
      domainId,
      slug: newSlug,
      destination: cleanDestination,
      utm,
    }),
    ...hold,
  };
  const messages = [
    ...renameSyncMessages(existing, updated, body, moved, hostname, oldHostname),
    // KV caches each address's fully-built redirect URL (destination + UTM applied), so every other active
    // address needs resyncing or it would keep serving the pre-edit URL. Unconditional: the messages are
    // cheap and self-healing (see activeAddressesOf).
    ...aliases.flatMap((a) => (a.kind === "primary" ? [] : [syncLinkMsg(a.slug, a.hostname)])),
  ];

  // The primary link_addresses row changes in the same batch as the links write, so the two never disagree.
  // Every statement carries the teardown guard: a rename that started just before teardown would otherwise
  // commit after the workflow's snapshot and leave the slug serving for an org that is gone (#52).
  const notDeleting = notDeletingSql(orgId);
  // Raw statements, not drizzle's: the alias is a conditional insert a plain INSERT builder cannot express,
  // and it has to ride the rename's batch to stay atomic.
  const writes = [
    toD1Statement(
      c.env,
      db
        .update(schema.links)
        .set(updated)
        .where(and(eq(schema.links.id, existing.id), notDeleting))
        .toSQL(),
    ),
    toD1Statement(
      c.env,
      db
        .update(schema.linkAddresses)
        .set({ domainId, slug: newSlug })
        .where(
          and(
            eq(schema.linkAddresses.linkId, existing.id),
            eq(schema.linkAddresses.kind, "primary"),
            notDeleting,
          ),
        )
        .toSQL(),
    ),
    ...(createsAlias
      ? [
          guardedTempAliasStatement(
            c.env,
            newAddressRow(
              existing.id,
              orgId,
              existing.domainId,
              existing.slug,
              "temp_alias",
              "renamed",
              Date.now() + ALIAS_TTL_MS,
            ),
          ),
        ]
      : []),
  ];
  const results = await c.env.DB.batch(writes);
  // The guard wrote nothing: the org started tearing down mid-request. Say so rather than answering 200.
  if (results[0] && results[0].meta.changes === 0)
    throw new HTTPException(409, { message: "Organization is being deleted" });
  await enqueueStorage(c.env, messages);

  // Re-score a changed destination (#68): the standard move is to register a clean destination, pass the
  // check, then swap it. mergedLinkUpdate already cleared the old verdict in the same write, so the link
  // reads as unscored from the moment it changed.
  if (updated.destination !== existing.destination)
    c.executionCtx.waitUntil(checkLinkDestination(c.env, updated));

  return c.json(await linkWithQuota(c.env, db, orgId, updated));
});

linkRoutes.delete("/:linkId", requireOrgRole("member"), async (c) => {
  const { db, orgId, link } = await linkFromRequest(c);
  // Gathered before the delete: every active address (primary + aliases) has
  // its own KV key, and the cascade only removes the D1 rows, not those keys.
  const addresses = await activeAddressesOf(db, link.id);
  await db.delete(schema.links).where(eq(schema.links.id, link.id));
  await enqueueStorage(c.env, [
    ...addresses.map((a) => syncLinkMsg(a.slug, a.hostname)),
    deleteQrLogoMsg(link.qrLogo),
  ]);
  // Bulk delete is this route once per link, so an org over its links cap
  // stops reconciling as soon as it is back under (#486).
  await reconcileAfterDelete(c.env, db, orgId, "links");
  return c.json(await okWithQuota(db, orgId));
});

linkRoutes.get("/:linkId/addresses", requireOrgRole("viewer"), async (c) => {
  const { db, link } = await linkFromRequest(c);
  const rows = await db
    .select({ address: schema.linkAddresses, hostname: schema.domains.hostname })
    .from(schema.linkAddresses)
    .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
    .where(eq(schema.linkAddresses.linkId, link.id))
    .orderBy(desc(schema.linkAddresses.createdAt));
  const dtos = await Promise.all(
    rows.map(async (r) => {
      const stats =
        r.address.kind === "primary"
          ? { recentClicks: 0, lastUse: null, referrers: [] }
          : await addressClickStats(db, r.address.id);
      return addressToDTO(c.env, r.address, r.hostname, stats);
    }),
  );
  return c.json(dtos);
});

linkRoutes.post("/:linkId/addresses", requireOrgRole("member"), async (c) => {
  const [body, { db, orgId, link }] = await Promise.all([
    c.req.json<{ slug?: string }>(),
    linkFromRequest(c),
  ]);
  validateSlug(body.slug);

  const [{ plan, limits }, activeCount] = await Promise.all([
    orgPlan(db, orgId),
    countActiveAddresses(db, orgId),
  ]);
  assertLinkQuota(activeCount, plan, limits);
  await assertAliasQuota(db, link.id);

  const domainId = link.domainId;
  const [hostname, resolvedSlug] = await Promise.all([
    newAddressHostname(db, orgId, domainId),
    resolveNewSlug(db, body.slug?.trim() || "", domainId),
  ]);
  const slug = await issueSlug(db, resolvedSlug);

  const address = newAddressRow(link.id, orgId, domainId, slug, "permanent_alias", "created");
  const { dto, status } = await insertAddressAndRespond(
    c.env,
    db,
    orgId,
    link,
    address,
    hostname,
    201,
    limits.links,
  );
  return c.json(dto, status);
});

const addressPatchSchema = v.object({ kind: v.picklist(["permanent", "primary"]) });

linkRoutes.patch("/:linkId/addresses/:addressId", requireOrgRole("member"), async (c) => {
  const body = parseBody(addressPatchSchema, await c.req.json<JsonValue>().catch(() => ({})));
  return body.kind === "primary" ? promoteAddress(c) : keepAddressForever(c);
});

async function keepAddressForever(c: Context<AppEnv>) {
  const { db, orgId, address } = await findLinkAndAddress(c);
  if (address.kind !== "temp_alias")
    throw new HTTPException(400, { message: "Only a temporary alias can be made permanent" });

  // Before the write, so nothing can refuse between it and the KV re-publish (#485).
  const [{ limits }, hostname] = await Promise.all([
    orgPlan(db, orgId),
    domainHostname(db, orgId, address.domainId),
  ]);

  // Atomic: the links cap is re-checked inside one D1 statement (#18). Also guarded on retired_at IS NULL:
  // if the daily sweep already retired this alias, the update affects zero rows rather than reviving it.
  const kept = await keepAddressForeverWithinLimit(c.env, {
    addressId: address.id,
    orgId,
    linkLimit: limits.links,
  });
  if (!kept) {
    const [current] = await db
      .select({ kind: schema.linkAddresses.kind, retiredAt: schema.linkAddresses.retiredAt })
      .from(schema.linkAddresses)
      .where(eq(schema.linkAddresses.id, address.id));
    if (!current || current.retiredAt !== null)
      throw new HTTPException(409, { message: "This address already expired" });
    // Still an active temp_alias: the guard failed on the cap, not a race. If it is no longer temp_alias, a
    // concurrent keep-forever already promoted it: fall through to the re-publish and success response
    // instead of a false upgrade prompt.
    if (current.kind === "temp_alias")
      throw new HTTPException(402, {
        message: "Upgrade your plan to keep more links",
        cause: { code: "link_limit" },
      });
  }

  // Re-publish is required: the cached expiresAt in KV must clear too, or lazy expiry still treats it as expired.
  await enqueueStorage(c.env, [syncLinkMsg(address.slug, hostname)]);
  return c.json(await okWithQuota(db, orgId));
}

// No `confirm` flag: asking before an irreversible click is the UI's job (#104).
linkRoutes.delete("/:linkId/addresses/:addressId", requireOrgRole("member"), async (c) => {
  const { db, orgId, address } = await findLinkAndAddress(c);
  if (address.kind === "primary")
    throw new HTTPException(400, {
      message: "Promote another address to primary before removing this one",
    });

  // Before the write: a lookup that threw after the update committed left the address retired in D1 and
  // still redirecting from KV (#485).
  const hostname = await domainHostname(db, orgId, address.domainId);
  const removed = await db
    .update(schema.linkAddresses)
    .set({ retiredAt: Date.now() })
    .where(and(eq(schema.linkAddresses.id, address.id), isNull(schema.linkAddresses.retiredAt)))
    .returning({ id: schema.linkAddresses.id });
  if (!removed.length) throw new HTTPException(409, { message: "This address is already gone" });
  await enqueueStorage(c.env, [syncLinkMsg(address.slug, hostname)]);
  // A permanent alias counts toward the links cap, so removing one can end
  // that overage too (#486).
  await reconcileAfterDelete(c.env, db, orgId, "links");
  return c.json(await okWithQuota(db, orgId));
});

async function promoteAddress(c: Context<AppEnv>) {
  const { db, orgId, link: existing, address } = await findLinkAndAddress(c);
  if (address.kind === "primary") {
    return c.json(await linkWithQuota(c.env, db, orgId, existing));
  }
  if (address.retiredAt !== null)
    throw new HTTPException(409, { message: "This address is no longer active" });

  // A temp_alias is free (see countActiveAddresses), but the old primary
  // becomes a permanent_alias below, so the org's counted total grows by one.
  if (address.kind === "temp_alias") {
    const [{ plan, limits }, activeCount] = await Promise.all([
      orgPlan(db, orgId),
      countActiveAddresses(db, orgId),
    ]);
    assertLinkQuota(activeCount, plan, limits);
  }

  // Swapping two rows' (domainId, slug) needs a placeholder step: SQLite checks the partial unique index per
  // statement, not at the end of the batch, so the target moves to a unique placeholder first. The old primary
  // becomes a permanent alias (an explicit choice, so no 48h temp).
  const [hostname, oldHostname] = await Promise.all([
    domainHostname(db, orgId, address.domainId),
    domainHostname(db, orgId, existing.domainId),
  ]);
  const updated: typeof schema.links.$inferSelect = {
    ...existing,
    domainId: address.domainId,
    slug: address.slug,
  };
  const placeholderSlug = `__promoting_${uid()}`;

  const writes = [
    db
      .update(schema.linkAddresses)
      .set({ slug: placeholderSlug })
      .where(eq(schema.linkAddresses.id, address.id)),
    db.update(schema.links).set(updated).where(eq(schema.links.id, existing.id)),
    db
      .update(schema.linkAddresses)
      .set({ domainId: address.domainId, slug: address.slug })
      .where(
        and(eq(schema.linkAddresses.linkId, existing.id), eq(schema.linkAddresses.kind, "primary")),
      ),
    db
      .update(schema.linkAddresses)
      .set({
        domainId: existing.domainId,
        slug: existing.slug,
        kind: "permanent_alias",
        creationReason: "promoted",
        expiresAt: null,
      })
      .where(eq(schema.linkAddresses.id, address.id)),
  ];
  const batch = nonEmpty(writes);
  if (batch) await db.batch(batch);
  await enqueueStorage(c.env, [
    syncLinkMsg(existing.slug, oldHostname),
    syncLinkMsg(address.slug, hostname),
  ]);

  return c.json(await linkWithQuota(c.env, db, orgId, updated));
}
