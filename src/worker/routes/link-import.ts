/**
 * Import from another service (#383): recreates links exported from Short.io,
 * Bitly, Rebrandly or Dub on the same domain and slug, so every short URL
 * already printed keeps landing where it did once the domain points here.
 *
 * The browser reads the file (src/shared/link-import.ts) and sends rows in
 * chunks: first to /check, which writes nothing and says what each row would
 * do, then to /run, which checks again and writes. Chunks keep each request
 * inside the body limit and one D1 batch, and let the page show progress.
 * Every row is checked on its own, so a retry sends the same rows back and
 * the ones already written come back as `exists`, never twice.
 *
 * Paid plans only: an imported link keeps its own slug, and chosen slugs exist
 * only on custom domains.
 */
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import * as v from "valibot";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { requireOrgRole } from "../org-role";
import { parseBody } from "../schemas";
import {
  countActiveAddresses,
  guardedAddressInsertStatement,
  orgPlan,
  toD1Statement,
} from "../plan";
import { enqueueStorage, syncLinkMsg } from "../storage";
import { isValidHttpUrl, normalizeUrl, RESERVED_SLUGS, SLUG_RE, uid } from "../util";
import { resolveUtm, stripUtmParams, type UtmFields } from "@/shared/utm";
import { blockHostOf } from "@/shared/abuse-rules";
import { isShortenerDestination } from "../abuse";
import { assertNotOwnShortLink } from "../abuse-hold";
import { newAddressRow, newLinkRow } from "./links";
import { orgLinkWarning } from "../link-warning";
import {
  CHECK_CHUNK_ROWS,
  IMPORT_CHUNK_ROWS,
  type ImportVerdict,
  type LinkImportDTO,
} from "@/shared/link-import";
import type { JsonValue } from "@/shared/types";

// Mounted at /api/orgs/:orgId/link-import
export const linkImportRoutes = new Hono<AppEnv>();

const Row = v.object({
  line: v.pipe(v.number(), v.integer()),
  host: v.pipe(v.string(), v.maxLength(253)),
  slug: v.pipe(v.string(), v.maxLength(2048)),
  destination: v.pipe(v.string(), v.maxLength(8192)),
  title: v.optional(v.pipe(v.string(), v.maxLength(500)), ""),
});
type Row = v.InferOutput<typeof Row>;

const rowsBody = (max: number) =>
  v.object({
    rows: v.pipe(
      v.array(Row),
      v.minLength(1, "Send at least one row"),
      v.maxLength(max, `Send at most ${max} rows at once`),
    ),
  });

/** A row this import can write: where it goes, and the link it becomes. */
interface Plan {
  row: Row;
  domainId: string;
  hostname: string;
  destination: string;
  utm: UtmFields;
}

type Checked = { verdict: ImportVerdict; plan?: Plan };

const failed = (row: Row, reason: string): Checked => ({
  verdict: { line: row.line, status: "failed", reason },
});

/** Imports are a paid feature (#383): a free org sees the upgrade, not a 402
 * on every chunk. */
async function paidPlan(db: DB, orgId: string) {
  const plan = await orgPlan(db, orgId);
  if (plan.plan === "free")
    throw new HTTPException(402, {
      message: "Importing links needs a paid plan",
      cause: { code: "import_locked" },
    });
  return plan;
}

/** What every row in a chunk would do, read in four queries however many
 * rows there are: the org's domains, the addresses already on those slugs,
 * the links behind them, and the blocklist. */
async function checkRows(env: Env, db: DB, orgId: string, rows: Row[]): Promise<Checked[]> {
  const domains = await db
    .select({
      id: schema.domains.id,
      hostname: schema.domains.hostname,
      lockedAt: schema.domains.lockedAt,
    })
    .from(schema.domains)
    .where(eq(schema.domains.orgId, orgId));
  const byHost = new Map(domains.map((domain) => [domain.hostname, domain]));

  const destinations = rows.map((row) => normalizeUrl(row.destination.trim()));
  const [taken, blocked] = await Promise.all([
    existingAddresses(
      db,
      domains.map((domain) => domain.id),
      rows,
    ),
    blockedHosts(db, destinations),
  ]);

  const seen = new Set<string>();
  return rows.map((row, index) => {
    const domain = byHost.get(row.host.toLowerCase());
    if (!domain) return failed(row, `${row.host} is not one of this organization's domains.`);
    if (domain.lockedAt)
      return failed(row, `${row.host} is over your plan's domains, so it takes no new links.`);
    const problem = slugProblem(row.slug);
    if (problem) return failed(row, problem);
    const key = `${domain.id}/${row.slug}`;
    if (seen.has(key)) return failed(row, "The same short URL is on an earlier line.");
    seen.add(key);

    const raw = destinations[index];
    const destinationProblem = destinationIssue(env, raw, blocked);
    if (destinationProblem) return failed(row, destinationProblem);
    const utm = resolveUtm(raw, {});
    const destination = stripUtmParams(raw);

    const existing = taken.get(key);
    if (existing) {
      const same = existing.destination === destination && sameUtm(existing, utm);
      return same
        ? { verdict: { line: row.line, status: "exists" } }
        : failed(row, `/${row.slug} on ${row.host} already goes somewhere else.`);
    }
    return {
      verdict: { line: row.line, status: "ready" },
      plan: { row, domainId: domain.id, hostname: domain.hostname, destination, utm },
    };
  });
}

/** Why a slug from another service cannot be one of ours, or null. Dub and
 * Rebrandly allow `/` and `.`, which a single path segment here cannot hold. */
function slugProblem(slug: string): string | null {
  if (!SLUG_RE.test(slug))
    return slug.length > 64
      ? "The slug is longer than 64 characters."
      : `The slug /${slug} uses characters we can't serve. Only letters, numbers, - and _ work here.`;
  if (RESERVED_SLUGS.has(slug.toLowerCase())) return `/${slug} is reserved here.`;
  return null;
}

/** The same refusals creating a link by hand gives, as a reason per row. */
function destinationIssue(env: Env, destination: string, blocked: Set<string>): string | null {
  if (!isValidHttpUrl(destination)) return "The destination is not a valid http(s) URL.";
  if (isShortenerDestination(destination))
    return "The destination is another link shortener. Point the link at the final URL.";
  const host = blockHostOf(destination);
  if (host && blocked.has(host)) return "That destination is not allowed on rdyrct.";
  try {
    assertNotOwnShortLink(env, destination);
  } catch {
    return "A link cannot point at another rdyrct short link.";
  }
  return null;
}

function sameUtm(a: UtmFields, b: UtmFields): boolean {
  return (
    a.utmSource === b.utmSource &&
    a.utmMedium === b.utmMedium &&
    a.utmCampaign === b.utmCampaign &&
    a.utmTerm === b.utmTerm &&
    a.utmContent === b.utmContent
  );
}

/** Active addresses already on the chunk's slugs, keyed `domainId/slug`, with
 * the destination of the link each belongs to. */
async function existingAddresses(db: DB, domainIds: string[], rows: Row[]) {
  const found = new Map<string, UtmFields & { destination: string }>();
  if (!domainIds.length) return found;
  const hits = await db
    .select({
      domainId: schema.linkAddresses.domainId,
      slug: schema.linkAddresses.slug,
      destination: schema.links.destination,
      utmSource: schema.links.utmSource,
      utmMedium: schema.links.utmMedium,
      utmCampaign: schema.links.utmCampaign,
      utmTerm: schema.links.utmTerm,
      utmContent: schema.links.utmContent,
    })
    .from(schema.linkAddresses)
    .innerJoin(schema.links, eq(schema.links.id, schema.linkAddresses.linkId))
    .where(
      and(
        inArray(schema.linkAddresses.domainId, domainIds),
        inArray(
          schema.linkAddresses.slug,
          rows.map((row) => row.slug),
        ),
        isNull(schema.linkAddresses.retiredAt),
      ),
    );
  for (const { domainId, slug, ...link } of hits) found.set(`${domainId}/${slug}`, link);
  return found;
}

async function blockedHosts(db: DB, destinations: string[]): Promise<Set<string>> {
  const hosts = [...new Set(destinations.map(blockHostOf).filter((host) => host !== null))];
  if (!hosts.length) return new Set();
  const rows = await db
    .select({ host: schema.blockedHosts.host })
    .from(schema.blockedHosts)
    .where(inArray(schema.blockedHosts.host, hosts));
  return new Set(rows.map((row) => row.host));
}

linkImportRoutes.post("/check", requireOrgRole("member"), async (c) => {
  const orgId = c.req.param("orgId")!;
  const db = c.var.db;
  const { rows } = parseBody(rowsBody(CHECK_CHUNK_ROWS), await c.req.json<JsonValue>());
  const [{ limits }, used, checked] = await Promise.all([
    paidPlan(db, orgId),
    countActiveAddresses(db, orgId),
    checkRows(c.env, db, orgId, rows),
  ]);
  return c.json({
    verdicts: checked.map((entry) => entry.verdict),
    // How many more links the plan takes, so the preview can say how many of
    // the ready rows will fit before anything is written.
    room: Math.max(0, limits.links - used),
  });
});

/* ---------------- the job: upload, start, follow ---------------- */

const MAX_IMPORT_ROWS = 20_000;

const NewImport = v.object({
  service: v.picklist(["shortio", "bitly", "rebrandly", "dub", "csv"]),
  total: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_IMPORT_ROWS)),
});

/** The import a request names, or a 404: an id from another org is not ours
 * to show. */
async function findImport(c: Context<AppEnv>) {
  const [job] = await c.var.db
    .select()
    .from(schema.linkImports)
    .where(
      and(
        eq(schema.linkImports.id, c.req.param("id")!),
        eq(schema.linkImports.orgId, c.req.param("orgId")!),
      ),
    );
  if (!job) throw new HTTPException(404, { message: "Import not found" });
  return job;
}

/**
 * Starts an import: the file's rows arrive next, in chunks. An import still
 * uploading from an earlier visit is dropped, since its rows came from a file
 * the person is now sending again; a running one makes this wait.
 */
linkImportRoutes.post("/", requireOrgRole("member"), async (c) => {
  const orgId = c.req.param("orgId")!;
  const db = c.var.db;
  const body = parseBody(NewImport, await c.req.json<JsonValue>());
  await paidPlan(db, orgId);
  const running = await db
    .select({ id: schema.linkImports.id })
    .from(schema.linkImports)
    .where(and(eq(schema.linkImports.orgId, orgId), eq(schema.linkImports.status, "running")));
  if (running.length)
    throw new HTTPException(409, {
      message: "An import is already running for this organization. Wait for it to finish.",
    });
  await db
    .update(schema.linkImports)
    .set({ status: "dismissed" })
    .where(
      and(
        eq(schema.linkImports.orgId, orgId),
        inArray(schema.linkImports.status, ["uploading", "done"]),
      ),
    );
  const id = uid();
  await db.insert(schema.linkImports).values({
    id,
    orgId,
    createdBy: c.var.user!.id,
    service: body.service,
    total: body.total,
    createdAt: Date.now(),
  });
  return c.json({ id }, 201);
});

/** A chunk of the file's rows. Sent again after an interruption, a row
 * already here is left alone (same line). */
linkImportRoutes.post("/:id/rows", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const job = await findImport(c);
  if (job.status !== "uploading")
    throw new HTTPException(409, { message: "This import is no longer taking rows." });
  const { rows } = parseBody(rowsBody(CHECK_CHUNK_ROWS), await c.req.json<JsonValue>());
  await db
    .insert(schema.linkImportRows)
    .values(
      rows.map((row) => ({
        importId: job.id,
        line: row.line,
        host: row.host.toLowerCase(),
        slug: row.slug,
        destination: row.destination,
        title: row.title,
      })),
    )
    .onConflictDoNothing();
  return c.json({ ok: true });
});

/** Every row is here: hand the import to the workflow. From now on it runs
 * whether or not anybody keeps the page open. */
linkImportRoutes.post("/:id/start", requireOrgRole("member"), async (c) => {
  const log = c.get("log");
  const orgId = c.req.param("orgId")!;
  const db = c.var.db;
  const job = await findImport(c);
  if (job.status !== "uploading") return c.json(await importStatus(db, job));
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.linkImportRows)
    .where(eq(schema.linkImportRows.importId, job.id));
  if (n !== job.total)
    throw new HTTPException(409, {
      message: "Some rows did not arrive. Choose the file again to send the rest.",
    });
  // Conditional, so two /start calls racing each other start one workflow.
  const moved = await c.env.DB.prepare(
    "update link_imports set status = 'running' where id = ? and status = 'uploading'",
  )
    .bind(job.id)
    .run();
  if (!moved.meta.changes) return c.json(await importStatus(db, await findImport(c)));
  await startWorkflow(c, job.id, job.id);
  log.set({ import: { id: job.id, service: job.service, rows: job.total } });
  log.audit({
    action: "link.import",
    actor: { type: "user", id: c.var.user!.id },
    target: { type: "org", id: orgId },
    outcome: "success",
  });
  return c.json(await importStatus(db, { ...job, status: "running" }));
});

/**
 * Starts the workflow for an import already marked running. If it cannot
 * start, nothing would ever finish the import and the org could not start
 * another, so its pending rows fail with a reason and Try again works.
 */
async function startWorkflow(c: Context<AppEnv>, importId: string, instanceId: string) {
  try {
    await c.env.LINK_IMPORT.create({ id: instanceId, params: { importId } });
  } catch (err) {
    c.get("log").error(err instanceof Error ? err : new Error(String(err)));
    await stopImport(c.env, importId);
    throw new HTTPException(502, { message: "Could not start the import. Try again." });
  }
}

/** The org's latest import that nobody has put away: what the page shows on
 * return, whether it is still running or finished while the tab was closed. */
linkImportRoutes.get("/current", requireOrgRole("member"), async (c) => {
  const orgId = c.req.param("orgId")!;
  const db = c.var.db;
  const [job] = await db
    .select()
    .from(schema.linkImports)
    .where(
      and(eq(schema.linkImports.orgId, orgId), sql`${schema.linkImports.status} != 'dismissed'`),
    )
    .orderBy(desc(schema.linkImports.createdAt))
    .limit(1);
  return c.json({ import: job ? await importStatus(db, job) : null });
});

/** Sends the failed rows through again: the plan may have room now, or the
 * slug may have been freed. */
linkImportRoutes.post("/:id/retry", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const job = await findImport(c);
  await paidPlan(db, job.orgId);
  const moved = await c.env.DB.prepare(
    "update link_imports set status = 'running', finished_at = null where id = ? and status = 'done'",
  )
    .bind(job.id)
    .run();
  if (!moved.meta.changes)
    throw new HTTPException(409, { message: "This import is still running." });
  await db
    .update(schema.linkImportRows)
    .set({ status: "pending", reason: "" })
    .where(
      and(eq(schema.linkImportRows.importId, job.id), eq(schema.linkImportRows.status, "failed")),
    );
  await startWorkflow(c, job.id, `${job.id}-${uid(6)}`);
  return c.json(await importStatus(db, { ...job, status: "running" }));
});

/** Puts a finished import away, so /import offers a new one. */
linkImportRoutes.post("/:id/dismiss", requireOrgRole("member"), async (c) => {
  const db = c.var.db;
  const job = await findImport(c);
  if (job.status === "running")
    throw new HTTPException(409, { message: "This import is still running." });
  await db
    .update(schema.linkImports)
    .set({ status: "dismissed" })
    .where(eq(schema.linkImports.id, job.id));
  return c.json({ ok: true });
});

/** How far an import has got: counts by outcome, its domains, and the first
 * rows that failed with why. */
async function importStatus(
  db: DB,
  job: typeof schema.linkImports.$inferSelect,
): Promise<LinkImportDTO> {
  const [counts, hosts, failures] = await Promise.all([
    db
      .select({ status: schema.linkImportRows.status, n: sql<number>`count(*)` })
      .from(schema.linkImportRows)
      .where(eq(schema.linkImportRows.importId, job.id))
      .groupBy(schema.linkImportRows.status),
    db
      .selectDistinct({ host: schema.linkImportRows.host })
      .from(schema.linkImportRows)
      .where(eq(schema.linkImportRows.importId, job.id)),
    db
      .select({
        line: schema.linkImportRows.line,
        host: schema.linkImportRows.host,
        slug: schema.linkImportRows.slug,
        reason: schema.linkImportRows.reason,
      })
      .from(schema.linkImportRows)
      .where(
        and(eq(schema.linkImportRows.importId, job.id), eq(schema.linkImportRows.status, "failed")),
      )
      .orderBy(schema.linkImportRows.line)
      .limit(50),
  ]);
  const count = (status: string) => counts.find((row) => row.status === status)?.n ?? 0;
  return {
    id: job.id,
    service: job.service,
    status: job.status,
    total: job.total,
    pending: count("pending"),
    imported: count("imported"),
    exists: count("exists"),
    failed: count("failed"),
    hosts: hosts.map((row) => row.host),
    failures,
  };
}

/** Rows one workflow step writes: two statements a row in one D1 batch. */
const STEP_ROWS = IMPORT_CHUNK_ROWS;

/**
 * Writes the next chunk of an import's pending rows and records each one's
 * outcome. Returns how many rows are still pending, so the workflow knows
 * when to stop. Safe to run twice on the same rows: a row already written
 * comes back `exists`.
 *
 * Links are left unscored: a null risk score is what puts a link first in the
 * risk cron's queue (#68), so they are scored within minutes anyway.
 */
export async function importNextChunk(env: Env, importId: string): Promise<number> {
  const db = drizzle(env.DB, { schema });
  const [job] = await db
    .select()
    .from(schema.linkImports)
    .where(eq(schema.linkImports.id, importId));
  if (!job) return 0;
  const rows = await db
    .select()
    .from(schema.linkImportRows)
    .where(
      and(
        eq(schema.linkImportRows.importId, importId),
        eq(schema.linkImportRows.status, "pending"),
      ),
    )
    .orderBy(schema.linkImportRows.line)
    .limit(STEP_ROWS);
  if (!rows.length) return 0;

  const { plan, limits } = await orgPlan(db, job.orgId);
  const outcomes: { line: number; status: "imported" | "exists" | "failed"; reason: string }[] = [];
  if (plan === "free") {
    for (const row of rows)
      outcomes.push({
        line: row.line,
        status: "failed",
        reason: "Importing links needs a paid plan.",
      });
  } else {
    const checked = await checkRows(env, db, job.orgId, rows);
    const plans = checked.flatMap((entry) => (entry.plan ? [entry.plan] : []));
    const written = await writeLinks(env, db, job.orgId, job.createdBy, plans, limits.links);
    for (const { verdict, plan: ready } of checked) {
      if (!ready) {
        const status = verdict.status === "exists" ? "exists" : "failed";
        outcomes.push({ line: verdict.line, status, reason: verdict.reason ?? "" });
      } else if (written.has(verdict.line))
        outcomes.push({ line: verdict.line, status: "imported", reason: "" });
      else
        outcomes.push({
          line: verdict.line,
          status: "failed",
          reason: "Your plan has no room for more links.",
        });
    }
    await enqueueStorage(
      env,
      plans
        .filter((ready) => written.has(ready.row.line))
        .map((ready) => syncLinkMsg(ready.row.slug, ready.hostname)),
    );
  }
  await env.DB.batch(
    outcomes.map((outcome) =>
      env.DB.prepare(
        "update link_import_rows set status = ?, reason = ? where import_id = ? and line = ?",
      ).bind(outcome.status, outcome.reason, importId, outcome.line),
    ),
  );
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.linkImportRows)
    .where(
      and(
        eq(schema.linkImportRows.importId, importId),
        eq(schema.linkImportRows.status, "pending"),
      ),
    );
  return n;
}

/** Marks an import done once no row is pending. */
/** Ends an import that cannot go on: whatever is still pending fails, so the
 * page shows it and offers to try those rows again. */
export async function stopImport(env: Env, importId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "update link_import_rows set status = 'failed', reason = ? where import_id = ? and status = 'pending'",
    ).bind("Something went wrong on our side. Try again.", importId),
    env.DB.prepare(
      "update link_imports set status = 'done', finished_at = ? where id = ? and status = 'running'",
    ).bind(Date.now(), importId),
  ]);
}

export async function finishImport(env: Env, importId: string): Promise<void> {
  await env.DB.prepare(
    "update link_imports set status = 'done', finished_at = ? where id = ? and status = 'running'",
  )
    .bind(Date.now(), importId)
    .run();
}

/**
 * Writes the ready rows in one D1 batch: a link insert and a cap-guarded
 * primary address per row, then one delete that takes back every link whose
 * address the cap refused. The same guard single link creation uses, so an
 * import can never take an org past its plan, even racing another request.
 * Returns the links that were written, by line.
 */
async function writeLinks(
  env: Env,
  db: DB,
  orgId: string,
  userId: string | null,
  plans: Plan[],
  linkLimit: number,
): Promise<Map<number, { id: string; destination: string }>> {
  if (!plans.length) return new Map();
  // Born warned while the org is (#344), the same as a link made by hand.
  const warning = await orgLinkWarning(db, orgId);
  const created = plans.map((plan) => {
    const link = {
      ...newLinkRow(
        orgId,
        plan.domainId,
        plan.row.slug,
        { destination: plan.destination, title: plan.row.title },
        plan.utm,
        userId,
      ),
      ...warning,
    };
    const address = newAddressRow(
      link.id,
      orgId,
      plan.domainId,
      plan.row.slug,
      "primary",
      "created",
    );
    return { plan, link, address };
  });
  const statements = created.flatMap(({ link, address }) => [
    toD1Statement(env, db.insert(schema.links).values(link).toSQL()),
    guardedAddressInsertStatement(env, address, linkLimit, 1),
  ]);
  const ids = created.map(({ link }) => link.id);
  statements.push(
    env.DB.prepare(
      `delete from links where id in (${ids.map(() => "?").join(",")})
       and not exists (select 1 from link_addresses where link_id = links.id)`,
    ).bind(...ids),
  );
  let results: D1Result[];
  try {
    results = await env.DB.batch(statements);
  } catch {
    // A unique index refused a row: someone took one of these slugs between
    // the check and the write. The batch rolled back whole; checking again
    // turns that row into a reason and lets the rest through.
    throw new HTTPException(409, {
      message: "Some of these links changed while importing. Import again to pick up the rest.",
    });
  }
  const written = new Map<number, { id: string; destination: string }>();
  created.forEach(({ plan, link }, index) => {
    if (results[index * 2 + 1].meta.changes > 0) written.set(plan.row.line, link);
  });
  return written;
}
