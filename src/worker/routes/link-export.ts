/** Export an org's links as CSV (#75). A GET passes requireOrgRole's write checks, so a locked org can still export. */
import { Hono } from "hono";
import { and, asc, eq, or, gt, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { requireOrgRole } from "../org-role";
import { linkClicksTotal } from "../rollups";
import { linkUrl } from "../util";
import { buildDestination } from "@/shared/utm";
import { csvRow } from "@/shared/csv";

export const linkExportRoutes = new Hono<AppEnv>();

/** Large: the stream reads every batch in one invocation and Workers Free allows 50 D1 queries there. */
export const EXPORT_BATCH = 500;

export const EXPORT_HEADER = [
  "Short link",
  "Destination URL",
  "Title",
  "Other short links",
  "Created at",
  "Clicks",
];

// Literal `links.id`, as in links.ts: an interpolated column renders unqualified.
const otherAddresses = sql<string | null>`(
  select group_concat(coalesce(d.hostname, '') || '/' || la.slug, ' ')
  from link_addresses la left join domains d on d.id = la.domain_id
  where la.link_id = links.id and la.retired_at is null and la.kind != 'primary'
)`;

async function batchAfter(db: DB, orgId: string, after: { createdAt: number; id: string } | null) {
  const { links } = schema;
  return db
    .select({
      link: links,
      domain: schema.domains.hostname,
      clicks: linkClicksTotal,
      others: otherAddresses,
    })
    .from(links)
    .leftJoin(schema.domains, eq(links.domainId, schema.domains.id))
    .where(
      and(
        eq(links.orgId, orgId),
        after
          ? or(
              gt(links.createdAt, after.createdAt),
              and(eq(links.createdAt, after.createdAt), gt(links.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(links.createdAt), asc(links.id))
    .limit(EXPORT_BATCH);
}

type ExportRow = Awaited<ReturnType<typeof batchAfter>>[number];

function toCells(env: Env, { link, domain, clicks, others }: ExportRow): string[] {
  const aliases = (others ?? "")
    .split(" ")
    .filter(Boolean)
    .map((address) => {
      const cut = address.indexOf("/");
      return linkUrl(env, address.slice(0, cut) || null, address.slice(cut + 1));
    });
  return [
    linkUrl(env, domain, link.slug),
    buildDestination(link.destination, link),
    link.title,
    aliases.join(" "),
    new Date(link.createdAt).toISOString(),
    String(clicks),
  ];
}

function filename(orgName: string): string {
  const name = orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `rdyrct-links-${name || "org"}-${new Date().toISOString().slice(0, 10)}.csv`;
}

linkExportRoutes.get("/", requireOrgRole("viewer"), async (c) => {
  const orgId = c.req.param("orgId")!;
  const db = c.var.db;
  const env = c.env;
  const log = c.get("log");
  log.set({ org: { id: orgId }, linkExport: true });
  const [org] = await db
    .select({ name: schema.orgs.name })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgId));

  const encoder = new TextEncoder();
  let after: { createdAt: number; id: string } | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // The BOM makes Excel read the file as UTF-8.
      controller.enqueue(encoder.encode(`﻿${csvRow(EXPORT_HEADER)}\r\n`));
    },
    async pull(controller) {
      const rows = await batchAfter(db, orgId, after);
      if (rows.length)
        controller.enqueue(
          encoder.encode(rows.map((row) => `${csvRow(toCells(env, row))}\r\n`).join("")),
        );
      if (rows.length < EXPORT_BATCH) return controller.close();
      const last = rows[rows.length - 1].link;
      after = { createdAt: last.createdAt, id: last.id };
    },
  });

  return c.body(body, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${filename(org?.name ?? "")}"`,
    "cache-control": "no-store",
  });
});
