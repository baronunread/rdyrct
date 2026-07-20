import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { requireOrgRole } from "../auth";
import { orgPlan } from "../plan";
import { publishLink, publishDomain, unpublishDomain } from "../kv";
import { uid, now } from "../util";
import { isValidHttpUrl } from "../util";
import type { DomainDTO } from "@/shared/types";

// e.g. links.example.com: at least one dot, no scheme/port/path
const HOSTNAME_RE =
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/* ---------------- Cloudflare for SaaS custom hostnames ---------------- */

interface CfHostname {
  id: string;
  active: boolean;
}

interface CfHostnameResult {
  status: string;
  ssl?: { status: string } | null;
}

async function cfRequest(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ result: Record<string, unknown> } | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${env.CF_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.error("cf api error", res.status, await res.text().catch(() => ""));
    return null;
  }
  return res.json();
}

async function cfCreateHostname(
  env: Env,
  hostname: string,
): Promise<CfHostname> {
  if (env.DEV_FAKE_CF === "1") return { id: `fake_${uid(8)}`, active: false };
  const data = await cfRequest(env, "POST", "/custom_hostnames", {
    hostname,
    ssl: { method: "http", type: "dv" },
  });
  if (!data)
    throw new HTTPException(502, {
      message: "Could not register the domain, try again shortly",
    });
  return { id: data.result.id as string, active: false };
}

async function cfGetHostnameStatus(
  env: Env,
  row: typeof schema.domains.$inferSelect,
): Promise<CfHostnameResult | null> {
  // The fake keeps new domains in checking_dns for ~5s before showing DNS as
  // resolved, then another ~3s before the certificate is "issued".
  if (env.DEV_FAKE_CF === "1") {
    const age = now() - row.createdAt;
    return {
      status: age > 5_000 ? "active" : "pending",
      ssl: age > 8_000 ? { status: "active" } : { status: "pending_validation" },
    };
  }
  if (!row.cfHostnameId) return null;
  const data = await cfRequest(
    env,
    "GET",
    `/custom_hostnames/${row.cfHostnameId}`,
  );
  if (!data) return null;
  return data.result as unknown as CfHostnameResult;
}

async function cfDeleteHostname(env: Env, cfHostnameId: string): Promise<void> {
  if (env.DEV_FAKE_CF === "1") return;
  await cfRequest(env, "DELETE", `/custom_hostnames/${cfHostnameId}`);
}

/* ---------------- activation pipeline ---------------- */

// Advance a domain one step through the DNS→TLS pipeline.  Returns the
// (possibly-updated) row.  Also called on every list read so polling drives it.
async function stepActivation(
  env: Env,
  db: DB,
  row: typeof schema.domains.$inferSelect,
): Promise<typeof schema.domains.$inferSelect> {
  if (row.status === "active" || row.status === "error") return row;
  const h = await cfGetHostnameStatus(env, row);
  if (!h) return row;

  if (row.status === "checking_dns") {
    if (h.status !== "active") return row;
    await db
      .update(schema.domains)
      .set({ status: "issuing_tls" })
      .where(eq(schema.domains.id, row.id));
    return { ...row, status: "issuing_tls" };
  }

  // status === "issuing_tls"
  if (h.ssl?.status !== "active") return row;
  await db
    .update(schema.domains)
    .set({ status: "active" })
    .where(eq(schema.domains.id, row.id));
  await publishDomain(env, row);
  const links = await db
    .select()
    .from(schema.links)
    .where(eq(schema.links.domainId, row.id));
  await Promise.all(links.map((l) => publishLink(env, l, row.hostname)));
  return { ...row, status: "active" };
}

/* ---------------- routes ---------------- */

// Mounted at /api/orgs/:orgId/domains: org admins, Pro only.
export const domainRoutes = new Hono<AppEnv>();

domainRoutes.use("*", requireOrgRole("admin"));

function toDTO(row: typeof schema.domains.$inferSelect): DomainDTO {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    rootRedirect: row.rootRedirect,
    createdAt: row.createdAt,
  };
}

async function getDomain(c: { var: { db: DB } }, orgId: string, id: string) {
  const rows = await c.var.db
    .select()
    .from(schema.domains)
    .where(and(eq(schema.domains.id, id), eq(schema.domains.orgId, orgId)));
  if (!rows[0]) throw new HTTPException(404, { message: "Domain not found" });
  return rows[0];
}

// List domains — activation runs on-read so auto-poll drives the pipeline.
domainRoutes.get("/", async (c) => {
  const rows = await c.var.db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.orgId, c.req.param("orgId")!));
  const settled = await Promise.all(
    rows.map((r) => stepActivation(c.env, c.var.db, r)),
  );
  return c.json(settled.map(toDTO));
});

// Add a domain: create the CF custom hostname and start in checking_dns.
domainRoutes.post("/", async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  const { limits } = await orgPlan(db, orgId);
  if (limits.domains === 0)
    throw new HTTPException(402, {
      message: "Custom domains are a Pro feature: upgrade to connect one",
    });
  const existing = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.domains)
    .where(eq(schema.domains.orgId, orgId));
  if ((existing[0]?.n ?? 0) >= limits.domains)
    throw new HTTPException(402, {
      message: `Your plan allows ${limits.domains} custom domains`,
    });

  const body = await c.req.json<{ hostname?: string }>();
  const hostname = body.hostname?.trim().toLowerCase() ?? "";
  if (!HOSTNAME_RE.test(hostname))
    throw new HTTPException(400, {
      message: "Enter a bare hostname like links.example.com",
    });
  if (hostname === c.env.APP_HOST)
    throw new HTTPException(400, { message: "That is this app's own domain" });
  const taken = await db
    .select({ id: schema.domains.id })
    .from(schema.domains)
    .where(eq(schema.domains.hostname, hostname));
  if (taken.length)
    throw new HTTPException(409, { message: "Domain already connected" });

  const cf = await cfCreateHostname(c.env, hostname);
  const row = {
    id: uid(),
    orgId,
    hostname,
    status: "checking_dns" as const,
    rootRedirect: "",
    cfHostnameId: cf.id,
    createdAt: now(),
  };
  await db.insert(schema.domains).values(row);
  // CF may already see the CNAME — advance immediately so the response toast
  // matches what the user sees.
  const settled = await stepActivation(c.env, db, row);
  return c.json(toDTO(settled), 201);
});

// Manual re-check: stepActivation one level and return the result.
domainRoutes.post("/:id/refresh", async (c) => {
  const row = await getDomain(c, c.req.param("orgId")!, c.req.param("id"));
  return c.json(toDTO(await stepActivation(c.env, c.var.db, row)));
});

domainRoutes.patch("/:id", async (c) => {
  const db = c.var.db;
  const [row, body] = await Promise.all([
    getDomain(c, c.req.param("orgId")!, c.req.param("id")),
    c.req.json<{ rootRedirect?: string }>(),
  ]);
  const rootRedirect = body.rootRedirect?.trim() ?? "";
  if (rootRedirect && !isValidHttpUrl(rootRedirect))
    throw new HTTPException(400, {
      message: "Root redirect must be a valid http(s) URL",
    });
  await db
    .update(schema.domains)
    .set({ rootRedirect })
    .where(eq(schema.domains.id, row.id));
  if (row.status === "active")
    await publishDomain(c.env, { ...row, rootRedirect });
  return c.json(toDTO({ ...row, rootRedirect }));
});

domainRoutes.delete("/:id", async (c) => {
  const db = c.var.db;
  const row = await getDomain(c, c.req.param("orgId")!, c.req.param("id"));
  const inUse = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.links)
    .where(eq(schema.links.domainId, row.id));
  if ((inUse[0]?.n ?? 0) > 0)
    throw new HTTPException(409, {
      message:
        "Links still use this domain, move or delete them first",
    });
  if (row.cfHostnameId) await cfDeleteHostname(c.env, row.cfHostnameId);
  await unpublishDomain(c.env, row.hostname);
  await db.delete(schema.domains).where(eq(schema.domains.id, row.id));
  return c.json({ ok: true });
});
