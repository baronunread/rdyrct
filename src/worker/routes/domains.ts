import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { requireOrgRole } from "../auth";
import { orgPlan } from "../plan";
import { enqueueStorage, syncDomainMsg } from "../storage";
import { uid, now } from "../util";
import { isValidHttpUrl, normalizeUrl } from "../util";
import type { DomainDTO } from "@/shared/types";

// e.g. links.example.com: at least one dot, no scheme/port/path
const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/* ---------------- Cloudflare for SaaS custom hostnames ---------------- */

interface CfHostname {
  id: string;
  active: boolean;
}

interface CfHostnameResult {
  status: string;
  ssl?: { status: string } | null;
}

async function cfRequest<T = Record<string, unknown>>(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
  opts?: { okNotFound?: boolean },
): Promise<{ result: T } | null> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // A caller deleting a hostname treats "already gone" as success, so a retried
  // or racing delete is a no-op instead of a hard failure.
  if (res.status === 404 && opts?.okNotFound) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("cf api error", res.status, text);
    let message = `Cloudflare API error ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { errors?: { message?: string }[] };
      message = parsed.errors?.[0]?.message ?? message;
    } catch {
      // Keep the status-based fallback when Cloudflare does not return JSON.
    }
    throw new HTTPException(502, { message });
  }
  return res.json();
}

async function cfCreateHostname(env: Env, hostname: string): Promise<CfHostname> {
  if (env.DEV_FAKE_CF === "1") return { id: `fake_${uid(8)}`, active: false };
  const data = await cfRequest(env, "POST", "/custom_hostnames", {
    hostname,
    ssl: { method: "http", type: "dv" },
  });
  return { id: data!.result.id as string, active: false };
}

/**
 * Find an existing custom hostname's id by name, or null when the zone has
 * none. This is the lookup half of get-or-create: a retried activation checks
 * here before creating, so it reuses a hostname a prior try already made rather
 * than creating a duplicate. Fake CF owns no hostnames.
 */
async function cfFindHostname(env: Env, hostname: string): Promise<string | null> {
  if (env.DEV_FAKE_CF === "1") return null;
  const data = await cfRequest<Array<{ id: string; hostname: string }>>(
    env,
    "GET",
    `/custom_hostnames?hostname=${encodeURIComponent(hostname)}`,
  );
  return data?.result?.[0]?.id ?? null;
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
  const data = await cfRequest(env, "GET", `/custom_hostnames/${row.cfHostnameId}`);
  if (!data) return null;
  return data.result as unknown as CfHostnameResult;
}

export async function cfDeleteHostname(env: Env, cfHostnameId: string): Promise<void> {
  if (env.DEV_FAKE_CF === "1") return;
  // Tolerate an already-gone hostname (see okNotFound) so delete is idempotent.
  await cfRequest(env, "DELETE", `/custom_hostnames/${cfHostnameId}`, undefined, {
    okNotFound: true,
  });
}

/* ---------------- activation (driven by DomainActivateWorkflow) ---------------- */

// Real DNS propagation plus certificate validation can take hours, so give a
// domain a full day to reach active before we call it failed.
const ACTIVATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** One probe's outcome. `pending` carries the current status for logging/tests. */
export type DomainProbe =
  | { state: "pending"; status: "checking_dns" | "issuing_tls" }
  | { state: "active" }
  | { state: "error"; reason: string }
  | { state: "gone" };

/**
 * Ensure the domain has a Cloudflare custom hostname and record its id in D1,
 * get-or-create style. Safe to run any number of times:
 *  - if D1 already holds the id, return it and never call Cloudflare;
 *  - else look the hostname up on the zone (a prior try may have created it but
 *    failed before saving the id) and create it only when truly absent;
 *  - if the domain row was deleted while we worked, undo the hostname we just
 *    ensured so a quick add-then-delete leaves nothing orphaned on Cloudflare.
 * This is what stops a duplicate or retried job from creating a second custom
 * hostname for the same domain. Returns the id, or null if the domain is gone.
 */
export async function ensureHostname(
  env: Env,
  domainId: string,
  hostname: string,
): Promise<string | null> {
  const db = drizzle(env.DB, { schema });
  const [row] = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.id, domainId))
    .limit(1);
  if (!row) return null;
  if (row.cfHostnameId) return row.cfHostnameId;

  const existing = await cfFindHostname(env, hostname);
  const id = existing ?? (await cfCreateHostname(env, hostname)).id;

  // RETURNING is empty when the row was deleted meanwhile: compensate.
  const saved = await db
    .update(schema.domains)
    .set({ cfHostnameId: id })
    .where(eq(schema.domains.id, domainId))
    .returning({ id: schema.domains.id });
  if (!saved.length) {
    await cfDeleteHostname(env, id);
    return null;
  }
  return id;
}

/**
 * Move a domain one step along the DNS→TLS pipeline, writing the new status to
 * D1. Idempotent: an already-active or already-errored domain is returned
 * unchanged, and re-running lands on the same D1 state. Publishing the KV
 * redirect key is a separate workflow step, so this never touches KV.
 */
export async function probeDomain(env: Env, domainId: string): Promise<DomainProbe> {
  const db = drizzle(env.DB, { schema });
  const [row] = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.id, domainId))
    .limit(1);
  if (!row) return { state: "gone" };
  if (row.status === "active") return { state: "active" };
  if (row.status === "error") return { state: "error", reason: row.statusReason };

  if (now() - row.createdAt > ACTIVATION_TIMEOUT_MS) {
    const reason =
      row.status === "checking_dns"
        ? "We never saw the CNAME record resolve. Check it at your DNS provider, then delete and re-add the domain."
        : "The TLS certificate was never issued. Delete and re-add the domain to try again.";
    await db
      .update(schema.domains)
      .set({ status: "error", statusReason: reason })
      .where(eq(schema.domains.id, domainId));
    return { state: "error", reason };
  }

  const h = await cfGetHostnameStatus(env, row);
  if (!h) return { state: "pending", status: row.status };

  if (row.status === "checking_dns") {
    if (h.status !== "active") return { state: "pending", status: "checking_dns" };
    await db
      .update(schema.domains)
      .set({ status: "issuing_tls" })
      .where(eq(schema.domains.id, domainId));
    return { state: "pending", status: "issuing_tls" };
  }

  // status === "issuing_tls"
  if (h.ssl?.status !== "active") return { state: "pending", status: "issuing_tls" };
  await db.update(schema.domains).set({ status: "active" }).where(eq(schema.domains.id, domainId));
  return { state: "active" };
}

/**
 * Seconds to wait before the next probe. Fast at first (a pre-created CNAME
 * resolves in seconds), then a steady interval. Sleeps do not count toward the
 * Workflow step limit, and the 24h deadline in probeDomain bounds the loop.
 */
export function probeDelaySeconds(attempt: number): number {
  const ramp = [5, 5, 10, 20, 30, 60, 120];
  return attempt < ramp.length ? ramp[attempt] : 300;
}

/* ---------------- routes ---------------- */

// Mounted at /api/orgs/:orgId/domains: org admins, paid plans only.
export const domainRoutes = new Hono<AppEnv>();

domainRoutes.use("*", requireOrgRole("admin"));

function toDTO(row: typeof schema.domains.$inferSelect): DomainDTO {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    statusReason: row.statusReason,
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

// List domains. A pure read: activation runs in the background workflow, never
// on a GET, so this never calls Cloudflare or writes D1/KV.
domainRoutes.get("/", async (c) => {
  const rows = await c.var.db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.orgId, c.req.param("orgId")!));
  return c.json(rows.map(toDTO));
});

// Add a domain: commit the D1 row, then hand activation to the background
// workflow. The request never calls Cloudflare, so provider latency and partial
// failures stay out of the user-facing path.
domainRoutes.post("/", async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  const { limits } = await orgPlan(db, orgId);
  if (limits.domains === 0)
    throw new HTTPException(402, {
      message: "Custom domains are a paid feature: upgrade to connect one",
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
  if (taken.length) throw new HTTPException(409, { message: "Domain already connected" });

  const id = uid();
  const row = {
    id,
    orgId,
    hostname,
    status: "checking_dns" as const,
    statusReason: "",
    rootRedirect: "",
    cfHostnameId: null,
    createdAt: now(),
  };
  await db.insert(schema.domains).values(row);
  // Keyed by the row id, so a duplicate create can never spawn a second
  // activation (and so never a second custom hostname) for this domain.
  try {
    await c.env.DOMAIN_ACTIVATE.create({ id, params: { domainId: id, hostname } });
  } catch (err) {
    // Could not start activation: roll the row back so the domain does not sit
    // stuck in checking_dns with no workflow driving it.
    console.error("domain activation start failed", err);
    await db.delete(schema.domains).where(eq(schema.domains.id, id));
    throw new HTTPException(502, {
      message: "Could not start domain setup, please try again",
    });
  }
  return c.json(toDTO(row), 201);
});

// Manual re-check. A pure read now: the background workflow owns activation, so
// this only reflects the latest D1 status the workflow wrote.
domainRoutes.post("/:id/refresh", async (c) => {
  const row = await getDomain(c, c.req.param("orgId")!, c.req.param("id"));
  return c.json(toDTO(row));
});

domainRoutes.patch("/:id", async (c) => {
  const db = c.var.db;
  const [row, body] = await Promise.all([
    getDomain(c, c.req.param("orgId")!, c.req.param("id")),
    c.req.json<{ rootRedirect?: string }>(),
  ]);
  let rootRedirect = body.rootRedirect?.trim() ?? "";
  if (rootRedirect) {
    rootRedirect = normalizeUrl(rootRedirect);
    if (!isValidHttpUrl(rootRedirect))
      throw new HTTPException(400, {
        message: "Root redirect must be a valid http(s) URL",
      });
  }
  await db.update(schema.domains).set({ rootRedirect }).where(eq(schema.domains.id, row.id));
  await enqueueStorage(c.env, [row.status === "active" ? syncDomainMsg(row.hostname) : null]);
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
      message: "Links still use this domain, move or delete them first",
    });
  // Idempotent teardown (compensation for a delete that races activation):
  // remove the CF hostname whether or not we recorded its id (a mid-activation
  // add may have created it before saving the id), and tolerate it being gone.
  const cfId = row.cfHostnameId ?? (await cfFindHostname(c.env, row.hostname));
  if (cfId) await cfDeleteHostname(c.env, cfId);
  await db.delete(schema.domains).where(eq(schema.domains.id, row.id));
  // Syncing the now-orphaned domain key deletes it.
  await enqueueStorage(c.env, [syncDomainMsg(row.hostname)]);
  return c.json({ ok: true });
});
