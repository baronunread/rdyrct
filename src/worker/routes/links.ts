import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { requireOrgRole } from "../org-role";
import { deleteQrLogoMsg, enqueueStorage, syncLinkMsg } from "../storage";
import { orgPlan, countActiveAddresses } from "../plan";
import {
  uid,
  now,
  randomSlug,
  SLUG_RE,
  RESERVED_SLUGS,
  isValidHttpUrl,
  normalizeUrl,
  resolveUtm,
  stripUtmParams,
  validateQrFields,
  ALIAS_TTL_MS,
} from "../util";
import type { AddressDTO, LinkDTO, LinkInput, OrgPlan, PlanLimits, TopEntry } from "@/shared/types";

const RECENT_CLICKS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Active aliases (temp + permanent) a single link may hold at once: keeps the
// alias thread readable and caps how much of the org's link quota one link
// can soak up through kept-forever aliases.
const MAX_ALIASES_PER_LINK = 5;

// Mounted at /api/orgs/:orgId/links
export const linkRoutes = new Hono<AppEnv>();

/** Shared by link creation/rename and standalone address creation: a
 * provided slug must match the allowed charset and not be reserved. Empty or
 * missing is fine everywhere this is called (means "allocate a random one"). */
function validateSlug(slug: string | undefined): void {
  if (slug === undefined || slug === "") return;
  if (!SLUG_RE.test(slug))
    throw new HTTPException(400, {
      message: "Slug may only contain letters, numbers, - and _ (max 64)",
    });
  if (RESERVED_SLUGS.has(slug.toLowerCase()))
    throw new HTTPException(400, { message: "That slug is reserved" });
}

function validateInput(body: LinkInput, orgId: string, partial = false) {
  if ((!partial || body.destination !== undefined) && body.destination) {
    body.destination = normalizeUrl(body.destination.trim());
    if (!isValidHttpUrl(body.destination))
      throw new HTTPException(400, {
        message: "Destination must be a valid http(s) URL",
      });
  }
  validateSlug(body.slug);
  validateQrFields(body, orgId);
}

// NB: literal `links.id`; interpolating the drizzle column renders an
// unqualified "id" that SQLite resolves against the subquery's own table.
const clickCount = sql<number>`(
  select count(*) from clicks where clicks.link_id = links.id
)`.as("clicks");

// NB: same literal-`links.id` note as clickCount above.
const addressCount = sql<number>`(
  select count(*) from link_addresses
  where link_addresses.link_id = links.id and link_addresses.retired_at is null
)`.as("addressCount");

function toDTO(
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
  };
}

/** Fetches a link's total click count and current address count, then builds
 * its DTO: the shape every route handler needs after writing to a link, so
 * they all funnel through here instead of repeating the same two queries. */
async function linkToDTO(
  db: DB,
  orgId: string,
  row: typeof schema.links.$inferSelect,
): Promise<LinkDTO> {
  const [hostname, clicks, addressCount] = await Promise.all([
    domainHostname(db, orgId, row.domainId),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.clicks)
      .where(eq(schema.clicks.linkId, row.id)),
    countAddressesForLink(db, row.id),
  ]);
  return toDTO(row, clicks[0]?.n ?? 0, hostname, addressCount);
}

/** Inserts a new address row, publishes its KV key, and responds with the
 * link's fresh DTO: the shape both "add a standalone alias" and "merge into
 * an existing link" end with, once the address row itself is built. */
async function insertAddressAndRespond(
  env: Env,
  db: DB,
  orgId: string,
  link: typeof schema.links.$inferSelect,
  address: typeof schema.linkAddresses.$inferInsert,
  hostname: string | null,
  status: 200 | 201,
) {
  await db.insert(schema.linkAddresses).values(address);
  await enqueueStorage(env, [syncLinkMsg(address.slug, hostname)]);
  return { dto: await linkToDTO(db, orgId, link), status } as const;
}

/** Count active addresses for a single link, for call sites that don't
 * already have it from a batched query. */
async function countAddressesForLink(db: DB, linkId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.linkAddresses)
    .where(and(eq(schema.linkAddresses.linkId, linkId), isNull(schema.linkAddresses.retiredAt)));
  return rows[0]?.n ?? 0;
}

/** Rejects adding another alias once a link already holds MAX_ALIASES_PER_LINK
 * (temp + permanent combined, matching what the alias thread shows). */
async function assertAliasQuota(db: DB, linkId: string): Promise<void> {
  const activeAliases = (await countAddressesForLink(db, linkId)) - 1; // exclude primary
  if (activeAliases >= MAX_ALIASES_PER_LINK)
    throw new HTTPException(409, {
      message: `This link already has ${MAX_ALIASES_PER_LINK} aliases, the most allowed. Remove one before adding another.`,
      cause: { code: "alias_limit_reached" },
    });
}

/** True when the body carries any QR appearance override (a paid feature). */
function hasQrOverride(body: LinkInput): boolean {
  return !!(
    body.qrLogo ||
    body.qrStyle ||
    body.qrColor ||
    body.qrCorner ||
    body.qrBg ||
    body.qrEyeColor ||
    body.qrLogoSize != null
  );
}

/** Fetch a link inside an org or 404. */
async function findLink(db: DB, orgId: string, linkId: string) {
  const rows = await db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.id, linkId), eq(schema.links.orgId, orgId)));
  const link = rows[0];
  if (!link) throw new HTTPException(404, { message: "Link not found" });
  return link;
}

/**
 * 409 with a machine-readable code so the editor can shake the dialog and
 * point at the slug field. On the shared domain the message also pitches
 * custom domains, where the whole namespace is the org's own.
 */
function slugConflict(slug: string, sharedDomain: boolean): HTTPException {
  return new HTTPException(409, {
    message: sharedDomain
      ? `"/${slug}" is already taken on the shared domain.`
      : `"/${slug}" is already taken on this domain.`,
    cause: { code: "slug_taken" },
  });
}

/** Fetch one of a link's addresses inside an org or 404. */
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

/** Resolves the `:linkId`/`:addressId` params every address-mutation route
 * (keep-forever, remove, promote) starts from: the link and address, 404ing
 * if either doesn't belong to this org. */
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

function newAddressRow(
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
    createdAt: now(),
  };
}

/** Recent click count, last-use time, and top referrers for one address over
 * the last 7 days — only meaningful for a temp/permanent alias (the copy on
 * a temporary alias is "check where its clicks come from before it stops
 * working"), so the primary row skips this and reports zeros. */
async function addressClickStats(
  db: DB,
  addressId: string,
): Promise<{ recentClicks: number; lastUse: number | null; referrers: TopEntry[] }> {
  const cutoff = now() - RECENT_CLICKS_WINDOW_MS;
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
  row: typeof schema.linkAddresses.$inferSelect,
  hostname: string | null,
  stats: { recentClicks: number; lastUse: number | null; referrers: TopEntry[] },
): AddressDTO {
  return {
    id: row.id,
    domainId: row.domainId,
    domain: hostname,
    slug: row.slug,
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

/**
 * Every link in the org whose primary destination and UTM set exactly
 * matches (see #38): different UTM values never match, by construction,
 * since they are part of the comparison tuple. Aliases don't carry their own
 * destination, so this only ever needs to look at `links` itself. Usually
 * one row, but "create separate link anyway" lets a caller end up with
 * several, so the match dialog must offer all of them, not just the first.
 *
 * Restricted to `domainId`: an alias can only live on the same domain as the
 * link it addresses (see #38 grouped addresses), so a match on a different
 * domain could never actually be merged into and would just be a dead-end
 * suggestion.
 */
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

/**
 * Slug uniqueness is per-domain (null domain = the shared default host), and
 * lives on the active address set, not on `links` directly: a slug a link
 * just moved away from stays reserved by its own temp_alias/permanent_alias
 * row, not free for a stranger to grab, while a retired row never blocks
 * anything. `excludeLinkId` excludes every row belonging to that link (not
 * just one address), so promoting one of a link's own aliases to primary
 * never trips over that same link's other rows.
 */
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

/** True when this link already has an active address (an alias, since the
 * caller only checks this for a slug that differs from the current primary)
 * sitting on the given slug: renaming onto it would collide with that row
 * instead of freeing it up, so the caller must reject before writing. */
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

/**
 * Validates a target domain for a link: must exist and belong to the org.
 * Returns its hostname (used as the KV key prefix), or null for the shared
 * domain.
 */
async function domainHostname(
  db: DB,
  orgId: string,
  domainId: string | null,
): Promise<string | null> {
  if (!domainId) return null;
  const rows = await db
    .select({ hostname: schema.domains.hostname })
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.orgId, orgId)));
  if (!rows[0]) throw new HTTPException(400, { message: "Unknown domain for this org" });
  return rows[0].hostname;
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

function assertQrAllowed(body: LinkInput, limits: PlanLimits): void {
  if (hasQrOverride(body) && !limits.qr)
    throw new HTTPException(402, {
      message: "QR customization is a paid feature: upgrade to use it",
    });
}

/**
 * Resolves the slug for a new link: honors a chosen slug (custom domains
 * only) or allocates a random one, retrying on the unlikely collision.
 */
async function resolveNewSlug(db: DB, requested: string, domainId: string | null): Promise<string> {
  if (requested && domainId === null)
    throw new HTTPException(400, {
      message:
        "Links on the shared domain get random slugs: connect a custom domain (paid plans) to choose your own",
    });
  if (requested) {
    if (await slugTaken(db, requested, domainId)) throw slugConflict(requested, domainId === null);
    return requested;
  }
  for (let i = 0; i < 5; i++) {
    const candidate = randomSlug();
    if (!(await slugTaken(db, candidate, domainId))) return candidate;
  }
  throw new HTTPException(500, { message: "Could not allocate slug" });
}

/**
 * Resolves the slug for a rename: keeps the existing slug unless a new one
 * is requested. Chosen slugs exist only on custom domains.
 */
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

linkRoutes.get("/", requireOrgRole("member"), async (c) => {
  const rows = await c.var.db
    .select({
      link: schema.links,
      clicks: clickCount,
      domain: schema.domains.hostname,
      addressCount,
    })
    .from(schema.links)
    .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(eq(schema.links.orgId, c.req.param("orgId")!))
    .orderBy(desc(schema.links.createdAt));
  return c.json(rows.map((r) => toDTO(r.link, r.clicks, r.domain, r.addressCount)));
});

// Distinct from the links list's own count: a link plus its kept-forever
// aliases can consume more than one unit of the plan's `links` cap (a
// rename's automatic 48h temp_alias never does, see countActiveAddresses),
// so the UI needs this to show usage and gate creation accurately.
linkRoutes.get("/quota-usage", requireOrgRole("member"), async (c) => {
  const count = await countActiveAddresses(c.var.db, c.req.param("orgId")!);
  return c.json({ count });
});

/** Builds a new link row: unset appearance/UTM fields fall back to their
 * column default ("" or null), not to an existing row like an update would. */
function newLinkRow(
  orgId: string,
  domainId: string | null,
  slug: string,
  body: LinkInput,
  utm: ReturnType<typeof resolveUtm>,
  createdBy: string,
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
    createdAt: now(),
  };
}

linkRoutes.post("/", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<LinkInput>();
  const orgId = c.req.param("orgId")!;
  validateInput(body, orgId);
  const db = c.var.db;

  const [{ plan, limits }, activeCount] = await Promise.all([
    orgPlan(db, orgId),
    countActiveAddresses(db, orgId),
  ]);
  assertQrAllowed(body, limits);

  const domainId = body.domainId ?? null;
  // Slugs on the shared domain are always random (every plan): chosen slugs
  // exist only on custom domains, so the shared namespace can't be squatted.
  const [hostname, slug] = await Promise.all([
    domainHostname(db, orgId, domainId),
    resolveNewSlug(db, body.slug?.trim() || "", domainId),
  ]);

  // UTM params already in the destination are extracted into the columns so
  // analytics group-bys see them; explicit fields fill whatever is missing.
  // Then stripped back out of the destination itself, so it stays the bare
  // link and the columns are the only place UTM data lives.
  const utm = resolveUtm(body.destination, body);
  body.destination = stripUtmParams(body.destination);

  // Adding an address to a link the caller already resolved a same-destination
  // match against (see below): skip matching entirely, insert a permanent
  // alias on that link, and return its DTO — no new `links` row.
  if (body.mergeIntoLinkId) {
    const target = await findLink(db, orgId, body.mergeIntoLinkId);
    // An alias can only live on the same domain as the link it addresses
    // (see #38): the match list is already domain-filtered, but re-check
    // here in case the caller sent a stale mergeIntoLinkId.
    if (target.domainId !== domainId)
      throw new HTTPException(400, {
        message: "An address can only be added to a link on the same domain",
      });
    // The match list the caller acted on can be stale: confirm the target
    // still points at the destination the caller asked to merge into.
    if (
      target.destination !== body.destination ||
      target.utmSource !== utm.utmSource ||
      target.utmMedium !== utm.utmMedium ||
      target.utmCampaign !== utm.utmCampaign ||
      target.utmTerm !== utm.utmTerm ||
      target.utmContent !== utm.utmContent
    )
      throw new HTTPException(409, {
        message: "That link no longer has this destination. Review the link and try again.",
        cause: { code: "merge_target_changed" },
      });
    assertLinkQuota(activeCount, plan, limits);
    await assertAliasQuota(db, target.id);
    const address = newAddressRow(
      target.id,
      orgId,
      domainId,
      slug,
      "permanent_alias",
      "same_destination_merge",
    );
    const { dto, status } = await insertAddressAndRespond(
      c.env,
      db,
      orgId,
      target,
      address,
      hostname,
      200,
    );
    return c.json(dto, status);
  }

  // An exact destination+UTM match already exists in the org: offer to add
  // this address there instead of silently forking a second link. Different
  // UTM values are part of the match tuple, so they never trigger this.
  if (!body.forceSeparateLink) {
    const matches = await findSameDestinationLinks(db, orgId, body.destination, utm, domainId);
    if (matches.length) {
      const matchedLinks = await Promise.all(matches.map((match) => linkToDTO(db, orgId, match)));
      throw new HTTPException(409, {
        message:
          "This destination already belongs to a link. Add this address to the same link so its settings and analytics stay together.",
        cause: { code: "same_destination_match", matchedLinks },
      });
    }
  }

  assertLinkQuota(activeCount, plan, limits);
  const link = newLinkRow(orgId, domainId, slug, body, utm, c.var.user!.id);
  const address = newAddressRow(link.id, orgId, domainId, slug, "primary", "created");
  await db.batch([
    db.insert(schema.links).values(link),
    db.insert(schema.linkAddresses).values(address),
  ]);
  await enqueueStorage(c.env, [syncLinkMsg(link.slug, hostname)]);
  return c.json(toDTO(link, 0, hostname, 1), 201);
});

/** Merges a PATCH body over the existing row: an unset field (undefined)
 * keeps its existing value: `??` here is "not provided", not "falsy". */
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
    qrLogoSize: body.qrLogoSize ?? existing.qrLogoSize,
  };
}

/** A moved link leaves a stale key behind: syncing that old key finds no row
 * and deletes it. Syncing the new key publishes the updated row. */
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

/** Every active address of a link (primary + aliases), each with its own
 * hostname: the full set of KV keys that answer for it. Every message the
 * storage queue processes is self-healing (the consumer re-reads current D1
 * truth for that one key), so callers can freely resync this whole set
 * without first figuring out which fields actually changed. */
async function activeAddressesOf(db: DB, linkId: string) {
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

linkRoutes.patch("/:linkId", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<LinkInput>();
  const orgId = c.req.param("orgId")!;
  validateInput(body, orgId, true);
  const db = c.var.db;
  const { limits } = await orgPlan(db, orgId);
  assertQrAllowed(body, limits);
  const existing = await findLink(db, orgId, c.req.param("linkId")!);

  const domainId = body.domainId !== undefined ? body.domainId : existing.domainId;
  // A link's domain is fixed after creation (see `#38`): its aliases are
  // bound to that domain, so moving the primary would strand them. The
  // editor UI already greys the field out; this guards direct API calls.
  if (domainId !== existing.domainId)
    throw new HTTPException(400, {
      message: "A link's domain can't change. Create a new link on the other domain instead.",
    });
  // Chosen slugs exist only on custom domains; renaming a shared-domain link
  // is out for every plan, but keeping its existing slug stays allowed.
  const [hostname, oldHostname, newSlug, aliases] = await Promise.all([
    domainHostname(db, orgId, domainId),
    domainHostname(db, orgId, existing.domainId),
    resolveRenamedSlug(db, existing, body.slug?.trim() || "", domainId),
    // Gathered up front (pre-write): the primary's own before/after keys are
    // handled separately below, so this only ever needs each alias's own
    // (unaffected-by-this-write) slug/hostname.
    activeAddressesOf(db, existing.id),
  ]);
  const moved = newSlug !== existing.slug || domainId !== existing.domainId;
  // Only a custom-domain address leaves a temporary alias behind: shared-domain
  // slugs are random and never meant to be preserved (resolveRenamedSlug
  // already forbids choosing one), so a link moving away from the shared
  // domain just drops its old key like before.
  const createsAlias = moved && existing.domainId !== null;
  if (createsAlias) await assertAliasQuota(db, existing.id);

  const destination = body.destination ?? existing.destination;
  // Re-resolve against the final destination: its params win, explicit
  // fields fill gaps or clear, anything else keeps the existing value.
  // Then stripped back out, same as on create: destination stays the bare
  // link, existing.destination already is (or, pre-migration, may still
  // carry legacy embedded params, which this cleans up on next edit).
  const utm = resolveUtm(destination, body, existing);
  const cleanDestination = stripUtmParams(destination);

  const updated = mergedLinkUpdate(existing, body, {
    domainId,
    slug: newSlug,
    destination: cleanDestination,
    utm,
  });
  const messages = [
    ...renameSyncMessages(existing, updated, body, moved, hostname, oldHostname),
    // KV caches each address's fully-built redirect URL (destination + UTM
    // already applied), not just a pointer to the link: every other active
    // address needs resyncing too, or it would keep serving the pre-edit URL
    // until something else happened to touch it. Unconditional, not gated on
    // "did destination/UTM actually change" — these messages are cheap and
    // self-healing (see activeAddressesOf), so there's nothing to gain from
    // detecting a no-op edit that a routine PATCH doesn't already cost.
    ...aliases.flatMap((a) => (a.kind === "primary" ? [] : [syncLinkMsg(a.slug, a.hostname)])),
  ];

  // The primary link_addresses row is kept in sync with links.domainId/slug
  // in the same batch as the links write, never as a separate follow-up: the
  // two can never observably disagree (see decision #1 in the plan).
  const writes = [
    db.update(schema.links).set(updated).where(eq(schema.links.id, existing.id)),
    db
      .update(schema.linkAddresses)
      .set({ domainId, slug: newSlug })
      .where(
        and(eq(schema.linkAddresses.linkId, existing.id), eq(schema.linkAddresses.kind, "primary")),
      ),
    ...(createsAlias
      ? [
          db
            .insert(schema.linkAddresses)
            .values(
              newAddressRow(
                existing.id,
                orgId,
                existing.domainId,
                existing.slug,
                "temp_alias",
                "renamed",
                now() + ALIAS_TTL_MS,
              ),
            ),
        ]
      : []),
  ];
  await db.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
  await enqueueStorage(c.env, messages);

  return c.json(await linkToDTO(db, orgId, updated));
});

linkRoutes.delete("/:linkId", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  const link = await findLink(db, orgId, c.req.param("linkId")!);
  // Gathered before the delete: every active address (primary + aliases) has
  // its own KV key, and the cascade only removes the D1 rows, not those keys.
  const addresses = await activeAddressesOf(db, link.id);
  await db.delete(schema.links).where(eq(schema.links.id, link.id));
  // Syncing each now-orphaned key deletes it; the logo delete clears R2.
  await enqueueStorage(c.env, [
    ...addresses.map((a) => syncLinkMsg(a.slug, a.hostname)),
    deleteQrLogoMsg(link.qrLogo),
  ]);
  return c.json({ ok: true });
});

/* ---------------- addresses (aliases + primary) ---------------- */

linkRoutes.get("/:linkId/addresses", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  const link = await findLink(db, orgId, c.req.param("linkId")!);
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
      return addressToDTO(r.address, r.hostname, stats);
    }),
  );
  return c.json(dtos);
});

linkRoutes.post("/:linkId/addresses", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<{ slug?: string }>();
  const orgId = c.req.param("orgId")!;
  const db = c.var.db;
  const link = await findLink(db, orgId, c.req.param("linkId")!);
  validateSlug(body.slug);

  const [{ plan, limits }, activeCount] = await Promise.all([
    orgPlan(db, orgId),
    countActiveAddresses(db, orgId),
  ]);
  assertLinkQuota(activeCount, plan, limits);
  await assertAliasQuota(db, link.id);

  // An alias always lives on the same domain as the link it addresses (#38):
  // no domain picker, so there's nothing for a caller to get wrong here.
  const domainId = link.domainId;
  const [hostname, slug] = await Promise.all([
    domainHostname(db, orgId, domainId),
    resolveNewSlug(db, body.slug?.trim() || "", domainId),
  ]);

  const address = newAddressRow(link.id, orgId, domainId, slug, "permanent_alias", "created");
  const { dto, status } = await insertAddressAndRespond(
    c.env,
    db,
    orgId,
    link,
    address,
    hostname,
    201,
  );
  return c.json(dto, status);
});

linkRoutes.post(
  "/:linkId/addresses/:addressId/keep-forever",
  requireOrgRole("member"),
  async (c) => {
    const { db, orgId, address } = await findLinkAndAddress(c);
    if (address.kind !== "temp_alias")
      throw new HTTPException(400, { message: "Only a temporary alias can be kept forever" });

    const [{ plan, limits }, activeCount] = await Promise.all([
      orgPlan(db, orgId),
      countActiveAddresses(db, orgId),
    ]);
    assertLinkQuota(activeCount, plan, limits);

    // Guarded on retired_at IS NULL: if the daily sweep already retired this
    // alias (it missed the window between expiring and this request), the
    // update affects zero rows rather than reviving a dead one.
    const kept = await db
      .update(schema.linkAddresses)
      .set({ kind: "permanent_alias", expiresAt: null })
      .where(and(eq(schema.linkAddresses.id, address.id), isNull(schema.linkAddresses.retiredAt)))
      .returning({ id: schema.linkAddresses.id });
    if (!kept.length) throw new HTTPException(409, { message: "This address already expired" });

    // Re-publish is required, not optional: the cached expiresAt in KV must
    // clear too, or the redirect path's lazy-expiry check would still treat
    // this as expired.
    const hostname = await domainHostname(db, orgId, address.domainId);
    await enqueueStorage(c.env, [syncLinkMsg(address.slug, hostname)]);
    return c.json({ ok: true });
  },
);

linkRoutes.post("/:linkId/addresses/:addressId/remove", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<{ confirm?: boolean }>().catch(() => ({ confirm: false }));
  if (!body.confirm) throw new HTTPException(400, { message: "Confirm removal to continue" });

  const { db, orgId, address } = await findLinkAndAddress(c);
  if (address.kind === "primary")
    throw new HTTPException(400, {
      message: "Promote another address to primary before removing this one",
    });

  const [hostname, removed] = await Promise.all([
    domainHostname(db, orgId, address.domainId),
    db
      .update(schema.linkAddresses)
      .set({ retiredAt: now() })
      .where(and(eq(schema.linkAddresses.id, address.id), isNull(schema.linkAddresses.retiredAt)))
      .returning({ id: schema.linkAddresses.id }),
  ]);
  if (!removed.length) throw new HTTPException(409, { message: "This address is already gone" });
  // Re-publish now instead of waiting for the sweep: a removed address
  // should stop resolving immediately, not up to a day later.
  await enqueueStorage(c.env, [syncLinkMsg(address.slug, hostname)]);
  return c.json({ ok: true });
});

linkRoutes.post("/:linkId/addresses/:addressId/promote", requireOrgRole("member"), async (c) => {
  const { db, orgId, link: existing, address } = await findLinkAndAddress(c);
  if (address.kind === "primary") return c.json(await linkToDTO(db, orgId, existing));
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

  // Promoting reuses the rename mechanics: the target's slug/domain becomes
  // the new primary, and the current primary's slug/domain becomes a new
  // permanent alias (never a 48h temp: this was an explicit user choice, not
  // an automatic rename). No fresh uniqueness check is needed — both rows
  // are already valid, currently-active addresses. But swapping two existing
  // rows' (domainId, slug) values needs a placeholder step first: SQLite
  // checks the partial unique index immediately per statement, not deferred
  // to the end of the batch, so writing the primary row straight to the
  // target's (domainId, slug) would collide with the target's own row (still
  // holding those same values until its own statement runs). Moving the
  // target row to a guaranteed-unique placeholder slug first frees that pair
  // for the primary row, and only then does the target row take on the old
  // primary's (now-vacated) values.
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
  await db.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
  await enqueueStorage(c.env, [
    syncLinkMsg(existing.slug, oldHostname),
    syncLinkMsg(address.slug, hostname),
  ]);

  return c.json(await linkToDTO(db, orgId, updated));
});
