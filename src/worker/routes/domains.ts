import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import type { JsonValue } from "../../shared/types";
import { HTTPException } from "hono/http-exception";
import { eq, and, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { orgDeleting, requireOrgRole } from "../org-role";
import { orgPlan, insertDomainWithinLimit } from "../plan";
import { enqueueStorage, syncDomainMsg } from "../storage";
import { sharedLinkHost, uid } from "../util";
import { isValidHttpUrl, normalizeUrl } from "../util";
import { jsonBodyLimit } from "../body-limit";
import type { DomainDTO, PlanLimits } from "@/shared/types";

// e.g. links.example.com: at least one dot, no scheme/port/path
const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/* ---------------- Cloudflare for SaaS custom hostnames ---------------- */

interface CfHostname {
  id: string;
  active: boolean;
}

interface CfHostnameResult {
  status: string;
  ssl?: {
    status: string;
    validation_records?: { txt_name?: string; txt_value?: string }[] | null;
  } | null;
  /** The ownership TXT record, for a hostname not yet pointed at this zone. */
  ownership_verification?: { name?: string; value?: string } | null;
}

async function cfRequest<T = Record<string, JsonValue>>(
  env: Env,
  method: string,
  path: string,
  body?: JsonValue,
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
    Sentry.captureMessage("cf_api_error", { level: "error", extra: { status: res.status, text } });
    let message = `Cloudflare API error ${res.status}`;
    try {
      // SAFETY: this is Cloudflare's error envelope, and the catch below is
      // what handles a response that is not it.
      const parsed = JSON.parse(text) as { errors?: { message?: string }[] };
      message = parsed.errors?.[0]?.message ?? message;
    } catch (e) {
      // Keep the status-based fallback when Cloudflare does not return JSON,
      // but surface the unparseable body so a regression is visible.
      Sentry.captureException(e);
    }
    throw new HTTPException(502, { message });
  }
  return res.json();
}

// Fake Cloudflare responses only when explicitly opted into (local dev/e2e),
// never merely because credentials happen to be unset: a misconfigured
// deployment must fail closed, not silently mint fake hostnames.
function useFakeCf(env: Env): boolean {
  return env.CF_DEV_ENV === "simulated" || env.CF_DEV_ENV === "instant";
}

function assertCfConfigured(env: Env): void {
  if (!env.CF_API_TOKEN || !env.CF_ZONE_ID)
    throw new HTTPException(500, {
      message: "Custom domains are not configured on this deployment",
    });
}

async function cfCreateHostname(
  env: Env,
  hostname: string,
  validation: DomainDTO["validation"],
): Promise<CfHostname> {
  if (useFakeCf(env)) return { id: `fake_${uid(8)}`, active: false };
  assertCfConfigured(env);
  // "txt" issues the certificate from a TXT record (#383). At renewal
  // Cloudflare validates over HTTP by itself once the hostname points here,
  // so the customer never has to update the record.
  const data = await cfRequest<{ id: string }>(env, "POST", "/custom_hostnames", {
    hostname,
    ssl: { method: validation, type: "dv" },
  });
  return { id: data!.result.id, active: false };
}

/**
 * Find an existing custom hostname's id by name, or null when the zone has
 * none. This is the lookup half of get-or-create: a retried activation checks
 * here before creating, so it reuses a hostname a prior try already made rather
 * than creating a duplicate. Fake CF owns no hostnames.
 */
async function cfFindHostname(env: Env, hostname: string): Promise<string | null> {
  if (useFakeCf(env)) return null;
  assertCfConfigured(env);
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
  if (useFakeCf(env)) {
    // "instant" skips the staged delays entirely: an e2e run asserts on the
    // end state, and waiting out an artificial timer only buys a race against
    // whatever budget the test picked.
    if (env.CF_DEV_ENV === "instant") return { status: "active", ssl: { status: "active" } };
    // Otherwise walk the states on a timer so both are visible in a browser.
    // Each threshold sits strictly between two probes: probeDelaySeconds puts
    // them at 0s, 5s, 10s, 20s, 40s, and a threshold landing *on* one of those
    // is a coin flip. The TLS one used to be 20s, exactly probe 4, so losing
    // the toss pushed activation out to 40s.
    const age = Date.now() - row.createdAt;
    return {
      status: age > 3_000 ? "active" : "pending",
      ssl: age > 12_000 ? { status: "active" } : { status: "pending_validation" },
    };
  }
  assertCfConfigured(env);
  if (!row.cfHostnameId) return null;
  const data = await cfRequest<CfHostnameResult>(
    env,
    "GET",
    `/custom_hostnames/${row.cfHostnameId}`,
  );
  return data?.result ?? null;
}

export async function cfDeleteHostname(env: Env, cfHostnameId: string): Promise<void> {
  if (useFakeCf(env)) return;
  assertCfConfigured(env);
  // Tolerate an already-gone hostname (see okNotFound) so delete is idempotent.
  await cfRequest(env, "DELETE", `/custom_hostnames/${cfHostnameId}`, undefined, {
    okNotFound: true,
  });
}

/* ---------------- activation (driven by DomainActivateWorkflow) ---------------- */

// Real DNS propagation plus certificate validation can take hours, so give a
// domain a full day to reach active before we call it failed. A domain moving
// from another service (#383) waits on TXT records someone adds by hand,
// often days later, so it gets a week.
const ACTIVATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const TXT_ACTIVATION_TIMEOUT_MS = 7 * ACTIVATION_TIMEOUT_MS;

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
async function findDomainById(db: DB, domainId: string) {
  const [row] = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.id, domainId))
    .limit(1);
  return row;
}

export async function ensureHostname(
  env: Env,
  domainId: string,
  hostname: string,
): Promise<string | null> {
  const db = drizzle(env.DB, { schema });
  const row = await findDomainById(db, domainId);
  if (!row) return null;
  if (row.cfHostnameId) return row.cfHostnameId;

  const existing = await cfFindHostname(env, hostname);
  const id = existing ?? (await cfCreateHostname(env, hostname, row.validation)).id;

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
  const row = await findDomainById(db, domainId);
  if (!row) return { state: "gone" };
  if (row.status === "active") return { state: "active" };
  if (row.status === "error") return { state: "error", reason: row.statusReason };

  const deadline = row.validation === "txt" ? TXT_ACTIVATION_TIMEOUT_MS : ACTIVATION_TIMEOUT_MS;
  if (Date.now() - row.createdAt > deadline) {
    const reason =
      row.validation === "txt"
        ? "We never saw the TXT records. Check them at your DNS provider, then delete and re-add the domain."
        : row.status === "checking_dns"
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
domainRoutes.use("*", jsonBodyLimit());

domainRoutes.use("*", requireOrgRole("admin"));

function toDTO(row: typeof schema.domains.$inferSelect): DomainDTO {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    statusReason: row.statusReason,
    rootRedirect: row.rootRedirect,
    validation: row.validation,
    createdAt: row.createdAt,
    lockedAt: row.lockedAt,
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
  const log = c.get("log");
  log.set({ orgId: c.req.param("orgId") });
  const rows = await c.var.db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.orgId, c.req.param("orgId")!));
  return c.json(rows.map(toDTO));
});

async function assertDomainQuota(db: DB, orgId: string, limits: PlanLimits): Promise<void> {
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
}

/** Validates and normalizes a requested hostname: well-formed, not one of
 * this app's own hosts, and not already connected to another org. */
async function resolveNewHostname(
  db: DB,
  body: { hostname?: string },
  ownHosts: string[],
): Promise<string> {
  const hostname = body.hostname?.trim().toLowerCase() ?? "";
  if (!HOSTNAME_RE.test(hostname))
    throw new HTTPException(400, {
      message: "Enter a bare hostname like links.example.com",
    });
  if (ownHosts.includes(hostname))
    throw new HTTPException(400, { message: "That is this app's own domain" });
  const taken = await db
    .select({ id: schema.domains.id })
    .from(schema.domains)
    .where(eq(schema.domains.hostname, hostname));
  if (taken.length) throw new HTTPException(409, { message: "Domain already connected" });
  return hostname;
}

// Add a domain: commit the D1 row, then hand activation to the background
// workflow. The request never calls Cloudflare, so provider latency and partial
// failures stay out of the user-facing path.
domainRoutes.post("/", async (c) => {
  const log = c.get("log");
  const db = c.var.db;
  const orgId = c.req.param("orgId")!;
  log.set({ orgId });
  const { limits } = await orgPlan(db, orgId);
  await assertDomainQuota(db, orgId, limits);

  const body = await c.req.json<{ hostname?: string; validation?: string }>();
  const hostname = await resolveNewHostname(db, body, [c.env.APP_HOST, sharedLinkHost(c.env)]);
  const validation: DomainDTO["validation"] = body.validation === "txt" ? "txt" : "http";

  const id = uid();
  const row = {
    id,
    orgId,
    hostname,
    status: "checking_dns" as const,
    statusReason: "",
    rootRedirect: "",
    cfHostnameId: null,
    validation,
    lockedAt: null,
    createdAt: Date.now(),
  };
  // Atomic: the org's domains cap is re-checked at write time inside one D1
  // statement, not from the assertDomainQuota() count fetched above (see
  // issue #18).
  const inserted = await insertDomainWithinLimit(c.env, row, limits.domains);
  if (!inserted) {
    if (await orgDeleting(db, orgId))
      throw new HTTPException(409, { message: "Organization is being deleted" });
    throw new HTTPException(402, {
      message: "Upgrade your plan to connect more domains",
      cause: { code: "domain_limit" },
    });
  }
  // Keyed by the row id, so a duplicate create can never spawn a second
  // activation (and so never a second custom hostname) for this domain.
  try {
    await c.env.DOMAIN_ACTIVATE.create({ id, params: { domainId: id, hostname } });
  } catch (err) {
    log.error(err instanceof Error ? err : new Error(String(err)));
    // Could not start activation: roll the row back so the domain does not sit
    // stuck in checking_dns with no workflow driving it.
    Sentry.captureException(err);
    await db.delete(schema.domains).where(eq(schema.domains.id, id));
    throw new HTTPException(502, {
      message: "Could not start domain setup, please try again",
    });
  }
  return c.json(toDTO(row), 201);
});

// Manual re-check. A pure read: the background workflow owns activation, so
// this only reflects the latest D1 status the workflow wrote, which is why it
// is a GET (#104).
domainRoutes.get("/:id", async (c) => {
  const log = c.get("log");
  log.set({ orgId: c.req.param("orgId"), domainId: c.req.param("id") });
  const row = await getDomain(c, c.req.param("orgId")!, c.req.param("id"));
  return c.json(toDTO(row));
});

/**
 * The DNS records a domain needs (#383): always the CNAME, and for a "txt"
 * domain the two TXT records that let Cloudflare verify it and issue its
 * certificate while it still points at another service. Read live from
 * Cloudflare, which mints the values after the workflow creates the hostname,
 * so an empty `txt` means "not ready yet, ask again".
 */
domainRoutes.get("/:id/records", async (c) => {
  const row = await getDomain(c, c.req.param("orgId")!, c.req.param("id"));
  const cname = { type: "CNAME" as const, name: row.hostname, value: c.env.APP_HOST };
  if (row.validation !== "txt") return c.json({ records: [cname] });
  return c.json({ records: [...(await txtRecords(c.env, row)), cname] });
});

type DnsRecord = { type: "TXT" | "CNAME"; name: string; value: string };

async function txtRecords(env: Env, row: typeof schema.domains.$inferSelect): Promise<DnsRecord[]> {
  if (useFakeCf(env)) {
    return [
      { type: "TXT", name: `_cf-custom-hostname.${row.hostname}`, value: `fake-owner-${row.id}` },
      { type: "TXT", name: `_acme-challenge.${row.hostname}`, value: `fake-cert-${row.id}` },
    ];
  }
  if (!row.cfHostnameId || row.status === "active") return [];
  const data = await cfRequest<CfHostnameResult>(
    env,
    "GET",
    `/custom_hostnames/${row.cfHostnameId}`,
  );
  const owner = data?.result.ownership_verification;
  const records: DnsRecord[] = [];
  if (owner?.name && owner.value)
    records.push({ type: "TXT", name: owner.name, value: owner.value });
  for (const record of data?.result.ssl?.validation_records ?? []) {
    if (record.txt_name && record.txt_value)
      records.push({ type: "TXT", name: record.txt_name, value: record.txt_value });
  }
  return records;
}

domainRoutes.patch("/:id", async (c) => {
  const log = c.get("log");
  log.set({ orgId: c.req.param("orgId"), domainId: c.req.param("id") });
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
  const log = c.get("log");
  log.set({ orgId: c.req.param("orgId"), domainId: c.req.param("id") });
  const db = c.var.db;
  const row = await getDomain(c, c.req.param("orgId")!, c.req.param("id"));
  // link_addresses covers both a link's primary address and its aliases, so
  // this one check is enough: an alias-only reference (no link primarily on
  // this domain) still blocks the delete, same as a primary reference would.
  const inUse = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.linkAddresses)
    .where(and(eq(schema.linkAddresses.domainId, row.id), isNull(schema.linkAddresses.retiredAt)));
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
