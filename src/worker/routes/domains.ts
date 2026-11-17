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
import { reconcileAfterDelete } from "../reconcile";
import { sharedLinkHost, uid } from "../util";
import { isValidHttpUrl, normalizeUrl } from "../util";
import { jsonBodyLimit } from "../body-limit";
import { assertDestinationAllowed } from "../abuse-hold";
import type { DomainDTO, PlanLimits } from "@/shared/types";

const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

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
  // A caller deleting a hostname treats "already gone" as success, so a retried or racing delete is a no-op.
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
      // Keep the status fallback when Cloudflare returns no JSON, but surface the unparseable body.
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
    // "instant" skips the staged delays: e2e asserts on the end state.
    if (env.CF_DEV_ENV === "instant") return { status: "active", ssl: { status: "active" } };
    // Each threshold sits strictly between two probes (0s, 5s, 10s, 20s, 40s):
    // one landing on a probe is a coin flip.
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
  await cfRequest(env, "DELETE", `/custom_hostnames/${cfHostnameId}`, undefined, {
    okNotFound: true,
  });
}

// Real DNS propagation plus certificate validation can take hours: a day to reach active.
// A domain moving from another service (#383) waits on TXT records added by hand,
// often days later, so it gets a week.
const ACTIVATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const TXT_ACTIVATION_TIMEOUT_MS = 7 * ACTIVATION_TIMEOUT_MS;

function checkDeadline(row: {
  validation: DomainDTO["validation"];
  checkingSince: number | null;
  createdAt: number;
}): number {
  const timeout = row.validation === "txt" ? TXT_ACTIVATION_TIMEOUT_MS : ACTIVATION_TIMEOUT_MS;
  return (row.checkingSince ?? row.createdAt) + timeout;
}

export type DomainProbe =
  | { state: "pending"; status: "checking_dns" | "issuing_tls" }
  | { state: "active" }
  | { state: "error"; reason: string }
  | { state: "gone" };

// Get-or-create, safe to rerun: a prior try may have made the hostname and failed before
// saving the id. If the domain row was deleted meanwhile, undo the hostname so nothing
// is orphaned on Cloudflare.
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

// Idempotent. Publishing the KV redirect key is a separate workflow step, so this never touches KV.
export async function probeDomain(env: Env, domainId: string): Promise<DomainProbe> {
  const db = drizzle(env.DB, { schema });
  const row = await findDomainById(db, domainId);
  if (!row) return { state: "gone" };
  if (row.status === "active") return { state: "active" };
  if (row.status === "error") return { state: "error", reason: row.statusReason };

  if (Date.now() > checkDeadline(row)) {
    const reason =
      row.validation === "txt"
        ? "We never saw the TXT records. Check them at your DNS provider, then try again."
        : row.status === "checking_dns"
          ? "We never saw the CNAME record resolve. Check it at your DNS provider, then try again."
          : "The TLS certificate was never issued. Try again.";
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

  if (h.ssl?.status !== "active") return { state: "pending", status: "issuing_tls" };
  await db.update(schema.domains).set({ status: "active" }).where(eq(schema.domains.id, domainId));
  return { state: "active" };
}

// Fast at first, then every 5 minutes for about a day, then every 15: each probe is a billed
// Workflow step and a Cloudflare API call. The deadline in probeDomain bounds the loop.
const PROBE_RAMP = [5, 5, 10, 20, 30, 60, 120];
const PROBES_AT_FIVE_MINUTES = 288;
export function probeDelaySeconds(attempt: number): number {
  if (attempt < PROBE_RAMP.length) return PROBE_RAMP[attempt];
  return attempt < PROBE_RAMP.length + PROBES_AT_FIVE_MINUTES ? 300 : 900;
}

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
    checkUntil: row.status === "active" || row.status === "error" ? null : checkDeadline(row),
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

// A pure read: activation runs in the background workflow, never on a GET.
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

// The request never calls Cloudflare, so provider latency and partial failures
// stay out of the user-facing path.
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
    checkingSince: null,
    createdAt: Date.now(),
  };
  // Atomic: the domains cap is re-checked at write time inside one D1 statement,
  // not from the assertDomainQuota() count above (#18).
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
    // Roll the row back so it does not sit in checking_dns with no workflow driving it.
    Sentry.captureException(err);
    await db.delete(schema.domains).where(eq(schema.domains.id, id));
    throw new HTTPException(502, {
      message: "Could not start domain setup, please try again",
    });
  }
  return c.json(toDTO(row), 201);
});

// A pure read of the status the workflow last wrote, which is why it is a GET (#104).
domainRoutes.get("/:id", async (c) => {
  const log = c.get("log");
  log.set({ orgId: c.req.param("orgId"), domainId: c.req.param("id") });
  const row = await getDomain(c, c.req.param("orgId")!, c.req.param("id"));
  return c.json(toDTO(row));
});

// Restarts the check with a fresh deadline in a new activation (links may already use the
// domain, so delete-and-re-add is no way out). The hostname id is cleared so activation
// looks it up again, or creates it if Cloudflare dropped it.
domainRoutes.post("/:id/retry", async (c) => {
  const log = c.get("log");
  const orgId = c.req.param("orgId")!;
  log.set({ orgId, domainId: c.req.param("id") });
  const row = await getDomain(c, orgId, c.req.param("id"));
  if (row.status !== "error")
    throw new HTTPException(409, { message: "This domain is not waiting on a retry" });
  if (row.lockedAt)
    throw new HTTPException(409, {
      message: "This domain is beyond your plan, so it stays as it is",
    });
  const now = Date.now();
  const [retried] = await c.var.db
    .update(schema.domains)
    .set({ status: "checking_dns", statusReason: "", checkingSince: now, cfHostnameId: null })
    .where(and(eq(schema.domains.id, row.id), eq(schema.domains.status, "error")))
    .returning();
  if (!retried) throw new HTTPException(409, { message: "This domain is not waiting on a retry" });
  try {
    // A new instance id: the first activation, keyed by the row id, still exists.
    await c.env.DOMAIN_ACTIVATE.create({
      id: `${row.id}-${now}`,
      params: { domainId: row.id, hostname: row.hostname },
    });
  } catch (err) {
    log.error(err instanceof Error ? err : new Error(String(err)));
    Sentry.captureException(err);
    await c.var.db
      .update(schema.domains)
      .set({ status: "error", statusReason: row.statusReason, cfHostnameId: row.cfHostnameId })
      .where(eq(schema.domains.id, row.id));
    throw new HTTPException(502, { message: "Could not start the check, please try again" });
  }
  return c.json(toDTO(retried));
});

// Read live from Cloudflare, which mints the values after the workflow creates the
// hostname, so an empty `txt` means not ready yet.
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
        cause: { code: "bad_destination" },
      });
    // It answers the bare host and every slug the host does not know (index.ts), so it
    // gets the same destination rules as a link (#488).
    await assertDestinationAllowed(c.env, db, rootRedirect);
    // Not this host itself: the root redirect answers every miss, so it would loop.
    if (new URL(rootRedirect).hostname.toLowerCase() === row.hostname.toLowerCase())
      throw new HTTPException(422, {
        message: "The root redirect cannot point at this domain itself.",
        cause: { code: "own_domain" },
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
  // link_addresses covers primary addresses and aliases, so this one check blocks alias-only references too.
  const inUse = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.linkAddresses)
    .where(and(eq(schema.linkAddresses.domainId, row.id), isNull(schema.linkAddresses.retiredAt)));
  if ((inUse[0]?.n ?? 0) > 0)
    throw new HTTPException(409, {
      message: "Links still use this domain, move or delete them first",
    });
  // Remove the CF hostname whether or not its id was recorded (a mid-activation add may
  // have created it first), and tolerate it being gone.
  const cfId = row.cfHostnameId ?? (await cfFindHostname(c.env, row.hostname));
  if (cfId) await cfDeleteHostname(c.env, cfId);
  await db.delete(schema.domains).where(eq(schema.domains.id, row.id));
  await enqueueStorage(c.env, [syncDomainMsg(row.hostname)]);
  // One fewer domain can bring the org under its cap and unlock the one a downgrade locked (#486).
  await reconcileAfterDelete(c.env, db, row.orgId, "domains");
  return c.json({ ok: true });
});
