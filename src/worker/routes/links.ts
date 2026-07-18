import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and, desc, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireOrgRole } from "../auth";
import { publishLink, unpublishLink } from "../kv";
import {
  uid,
  now,
  randomSlug,
  SLUG_RE,
  RESERVED_SLUGS,
  isValidHttpUrl,
} from "../util";
import type { LinkDTO, LinkInput } from "@/shared/types";

// Mounted at /api/orgs/:orgId/links
export const linkRoutes = new Hono<AppEnv>();

const MAX_LOGO_BYTES = 96 * 1024; // data-URI logo stored inline in D1

function validateInput(body: LinkInput, partial = false) {
  if (!partial || body.destination !== undefined) {
    if (!body.destination || !isValidHttpUrl(body.destination))
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
  if (body.qrLogo) {
    if (!body.qrLogo.startsWith("data:image/"))
      throw new HTTPException(400, { message: "Logo must be an image" });
    if (body.qrLogo.length > MAX_LOGO_BYTES * 1.37)
      throw new HTTPException(400, { message: "Logo too large (max ~96 KB)" });
  }
}

// NB: literal `links.id` — interpolating the drizzle column renders an
// unqualified "id" that SQLite resolves against the subquery's own table.
const clickCount = sql<number>`(
  select count(*) from clicks where clicks.link_id = links.id
)`.as("clicks");

function toDTO(row: typeof schema.links.$inferSelect, clicks: number): LinkDTO {
  return {
    id: row.id,
    slug: row.slug,
    destination: row.destination,
    title: row.title,
    utmSource: row.utmSource,
    utmMedium: row.utmMedium,
    utmCampaign: row.utmCampaign,
    utmTerm: row.utmTerm,
    utmContent: row.utmContent,
    qrLogo: row.qrLogo,
    createdAt: row.createdAt,
    clicks,
  };
}

linkRoutes.get("/", requireOrgRole("member"), async (c) => {
  const rows = await c.var.db
    .select({ link: schema.links, clicks: clickCount })
    .from(schema.links)
    .where(eq(schema.links.orgId, c.req.param("orgId")!))
    .orderBy(desc(schema.links.createdAt));
  return c.json(rows.map((r) => toDTO(r.link, r.clicks)));
});

linkRoutes.post("/", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<LinkInput>();
  validateInput(body);
  const db = c.var.db;
  const orgId = c.req.param("orgId")!;

  let slug = body.slug?.trim() || "";
  if (slug) {
    const taken = await db
      .select({ id: schema.links.id })
      .from(schema.links)
      .where(eq(schema.links.slug, slug));
    if (taken.length)
      throw new HTTPException(409, { message: "Slug already in use" });
  } else {
    // random slugs: retry on the (unlikely) collision
    for (let i = 0; i < 5; i++) {
      slug = randomSlug();
      const taken = await db
        .select({ id: schema.links.id })
        .from(schema.links)
        .where(eq(schema.links.slug, slug));
      if (!taken.length) break;
      slug = "";
    }
    if (!slug)
      throw new HTTPException(500, { message: "Could not allocate slug" });
  }

  const link: typeof schema.links.$inferSelect = {
    id: uid(),
    orgId,
    slug,
    destination: body.destination,
    title: body.title?.trim() ?? "",
    utmSource: body.utmSource?.trim() ?? "",
    utmMedium: body.utmMedium?.trim() ?? "",
    utmCampaign: body.utmCampaign?.trim() ?? "",
    utmTerm: body.utmTerm?.trim() ?? "",
    utmContent: body.utmContent?.trim() ?? "",
    qrLogo: body.qrLogo ?? "",
    createdBy: c.var.user!.id,
    createdAt: now(),
  };
  await db.insert(schema.links).values(link);
  await publishLink(c.env, link);
  return c.json(toDTO(link, 0), 201);
});

linkRoutes.patch("/:linkId", requireOrgRole("member"), async (c) => {
  const body = await c.req.json<LinkInput>();
  validateInput(body, true);
  const db = c.var.db;
  const rows = await db
    .select()
    .from(schema.links)
    .where(
      and(
        eq(schema.links.id, c.req.param("linkId")!),
        eq(schema.links.orgId, c.req.param("orgId")!),
      ),
    );
  const existing = rows[0];
  if (!existing) throw new HTTPException(404, { message: "Link not found" });

  const newSlug = body.slug?.trim();
  if (newSlug && newSlug !== existing.slug) {
    const taken = await db
      .select({ id: schema.links.id })
      .from(schema.links)
      .where(eq(schema.links.slug, newSlug));
    if (taken.length)
      throw new HTTPException(409, { message: "Slug already in use" });
  }

  const updated = {
    ...existing,
    slug: newSlug || existing.slug,
    destination: body.destination ?? existing.destination,
    title: body.title?.trim() ?? existing.title,
    utmSource: body.utmSource?.trim() ?? existing.utmSource,
    utmMedium: body.utmMedium?.trim() ?? existing.utmMedium,
    utmCampaign: body.utmCampaign?.trim() ?? existing.utmCampaign,
    utmTerm: body.utmTerm?.trim() ?? existing.utmTerm,
    utmContent: body.utmContent?.trim() ?? existing.utmContent,
    qrLogo: body.qrLogo ?? existing.qrLogo,
  };
  await db
    .update(schema.links)
    .set(updated)
    .where(eq(schema.links.id, existing.id));

  if (updated.slug !== existing.slug) await unpublishLink(c.env, existing.slug);
  await publishLink(c.env, updated);

  const clicks = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.clicks)
    .where(eq(schema.clicks.linkId, existing.id));
  return c.json(toDTO(updated, clicks[0]?.n ?? 0));
});

linkRoutes.delete("/:linkId", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const rows = await db
    .select()
    .from(schema.links)
    .where(
      and(
        eq(schema.links.id, c.req.param("linkId")!),
        eq(schema.links.orgId, c.req.param("orgId")!),
      ),
    );
  const link = rows[0];
  if (!link) throw new HTTPException(404, { message: "Link not found" });
  await db.delete(schema.links).where(eq(schema.links.id, link.id));
  await unpublishLink(c.env, link.slug);
  return c.json({ ok: true });
});
