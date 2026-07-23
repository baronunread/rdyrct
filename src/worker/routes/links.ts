import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and, desc, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB } from "../env";
import { requireOrgRole } from "../auth";
import { publishLink, unpublishLink } from "../kv";
import { deleteQrLogo } from "../r2";
import { orgPlan } from "../plan";
import {
  uid,
  now,
  randomSlug,
  SLUG_RE,
  RESERVED_SLUGS,
  isValidHttpUrl,
  normalizeUrl,
  resolveUtm,
  validateQrFields,
} from "../util";
import type { LinkDTO, LinkInput } from "@/shared/types";

// Mounted at /api/orgs/:orgId/links
export const linkRoutes = new Hono<AppEnv>();

function validateInput(body: LinkInput, orgId: string, partial = false) {
  if ((!partial || body.destination !== undefined) && body.destination) {
    body.destination = normalizeUrl(body.destination.trim());
    if (!isValidHttpUrl(body.destination))
      throw new HTTPException(400, {
        message: "Destination must be a valid http(s) URL",
      });
  }
  if (body.slug !== undefined && body.slug !== "") {
    if (!SLUG_RE.test(body.slug))
      throw new HTTPException(400, {
        message: "Slug may only contain letters, numbers, - and _ (max 64)",
      });
    if (RESERVED_SLUGS.has(body.slug.toLowerCase()))
      throw new HTTPException(400, { message: "That slug is reserved" });
  }
  validateQrFields(body, orgId);
}

// NB: literal `links.id`; interpolating the drizzle column renders an
// unqualified "id" that SQLite resolves against the subquery's own table.
const clickCount = sql<number>`(
  select count(*) from clicks where clicks.link_id = links.id
)`.as("clicks");

function toDTO(
  row: typeof schema.links.$inferSelect,
  clicks: number,
  domain: string | null,
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
    createdBy: row.createdBy,
  };
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
    body.qrLogoSize !== undefined
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

/** Slug uniqueness is per-domain (null domain = the shared default host). */
async function slugTaken(
  db: DB,
  slug: string,
  domainId: string | null,
  excludeLinkId?: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.links.id })
    .from(schema.links)
    .where(
      and(
        eq(schema.links.slug, slug),
        sql`ifnull(${schema.links.domainId}, '') = ${domainId ?? ""}`,
      ),
    );
  return rows.some((r) => r.id !== excludeLinkId);
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

linkRoutes.get("/", requireOrgRole("member"), async (c) => {
  const rows = await c.var.db
    .select({
      link: schema.links,
      clicks: clickCount,
      domain: schema.domains.hostname,
    })
    .from(schema.links)
    .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(eq(schema.links.orgId, c.req.param("orgId")!))
    .orderBy(desc(schema.links.createdAt));
  return c.json(rows.map((r) => toDTO(r.link, r.clicks, r.domain)));
});

linkRoutes.post("/", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<LinkInput>();
  const orgId = c.req.param("orgId")!;
  validateInput(body, orgId);
  const db = c.var.db;

  const [{ plan, limits }, linkCount] = await Promise.all([
    orgPlan(db, orgId),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.links)
      .where(eq(schema.links.orgId, orgId)),
  ]);
  if ((linkCount[0]?.n ?? 0) >= limits.links)
    throw new HTTPException(402, {
      message:
        plan === "free"
          ? `The free plan allows ${limits.links} links, upgrade to a paid plan for more`
          : `This plan allows at most ${limits.links} links`,
    });
  if (hasQrOverride(body) && !limits.qr)
    throw new HTTPException(402, {
      message: "QR customization is a paid feature: upgrade to use it",
    });

  const domainId = body.domainId ?? null;
  const hostname = await domainHostname(db, orgId, domainId);

  let slug = body.slug?.trim() || "";
  // Slugs on the shared domain are always random (every plan): chosen slugs
  // exist only on custom domains, so the shared namespace can't be squatted.
  if (slug && domainId === null)
    throw new HTTPException(400, {
      message:
        "Links on the shared domain get random slugs: connect a custom domain (paid plans) to choose your own",
    });
  if (slug) {
    if (await slugTaken(db, slug, domainId)) throw slugConflict(slug, domainId === null);
  } else {
    // random slugs: retry on the (unlikely) collision
    for (let i = 0; i < 5; i++) {
      slug = randomSlug();
      if (!(await slugTaken(db, slug, domainId))) break;
      slug = "";
    }
    if (!slug) throw new HTTPException(500, { message: "Could not allocate slug" });
  }

  // UTM params already in the destination are extracted into the columns so
  // analytics group-bys see them; explicit fields fill whatever is missing.
  const utm = resolveUtm(body.destination, body);

  const link: typeof schema.links.$inferSelect = {
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
    createdBy: c.var.user!.id,
    createdAt: now(),
  };
  await db.insert(schema.links).values(link);
  await publishLink(c.env, link, hostname);
  return c.json(toDTO(link, 0, hostname), 201);
});

linkRoutes.patch("/:linkId", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<LinkInput>();
  const orgId = c.req.param("orgId")!;
  validateInput(body, orgId, true);
  const db = c.var.db;
  const { limits } = await orgPlan(db, orgId);
  if (hasQrOverride(body) && !limits.qr)
    throw new HTTPException(402, {
      message: "QR customization is a paid feature: upgrade to use it",
    });
  const existing = await findLink(db, orgId, c.req.param("linkId")!);

  const domainId = body.domainId !== undefined ? body.domainId : existing.domainId;
  const [hostname, oldHostname] = await Promise.all([
    domainHostname(db, orgId, domainId),
    domainHostname(db, orgId, existing.domainId),
  ]);

  const newSlug = body.slug?.trim() || existing.slug;
  // Chosen slugs exist only on custom domains; renaming a shared-domain link
  // is out for every plan, but keeping its existing slug stays allowed.
  if (newSlug !== existing.slug && domainId === null)
    throw new HTTPException(400, {
      message:
        "Links on the shared domain keep their random slug: move the link to a custom domain to choose one",
    });
  const moved = newSlug !== existing.slug || domainId !== existing.domainId;
  if (moved && (await slugTaken(db, newSlug, domainId, existing.id)))
    throw slugConflict(newSlug, domainId === null);

  const destination = body.destination ?? existing.destination;
  // Re-resolve against the final destination: its params win, explicit
  // fields fill gaps or clear, anything else keeps the existing value.
  const utm = resolveUtm(destination, body, existing);

  const updated = {
    ...existing,
    domainId,
    slug: newSlug,
    destination,
    title: body.title?.trim() ?? existing.title,
    utmSource: utm.utmSource,
    utmMedium: utm.utmMedium,
    utmCampaign: utm.utmCampaign,
    utmTerm: utm.utmTerm,
    utmContent: utm.utmContent,
    qrLogo: body.qrLogo ?? existing.qrLogo,
    qrStyle: body.qrStyle ?? existing.qrStyle,
    qrColor: body.qrColor ?? existing.qrColor,
    qrCorner: body.qrCorner ?? existing.qrCorner,
    qrBg: body.qrBg ?? existing.qrBg,
    qrEyeColor: body.qrEyeColor ?? existing.qrEyeColor,
    qrLogoSize: body.qrLogoSize ?? existing.qrLogoSize,
  };
  await db.update(schema.links).set(updated).where(eq(schema.links.id, existing.id));

  if (moved) await unpublishLink(c.env, existing.slug, oldHostname);
  await publishLink(c.env, updated, hostname);
  // The old logo object is unreferenced once the row points at the new one.
  if (body.qrLogo !== undefined && body.qrLogo !== existing.qrLogo)
    await deleteQrLogo(c.env, existing.qrLogo);

  const clicks = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.clicks)
    .where(eq(schema.clicks.linkId, existing.id));
  return c.json(toDTO(updated, clicks[0]?.n ?? 0, hostname));
});

linkRoutes.delete("/:linkId", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  const link = await findLink(db, orgId, c.req.param("linkId")!);
  const hostname = await domainHostname(db, orgId, link.domainId);
  await db.delete(schema.links).where(eq(schema.links.id, link.id));
  await unpublishLink(c.env, link.slug, hostname);
  await deleteQrLogo(c.env, link.qrLogo);
  return c.json({ ok: true });
});
