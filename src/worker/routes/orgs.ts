import { Hono } from "hono";
import * as v from "valibot";
import type { JsonValue } from "../../shared/types";
import { HTTPException } from "hono/http-exception";
import { eq, and, gte, desc, sql, isNull, isNotNull, lt, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import { captureAlert } from "../sentry";
import type { AppEnv, DB, Env } from "../env";
import { requireUser } from "../guards";
import { requireOrgRole, orgRole } from "../org-role";
import {
  orgPlan,
  userPlan,
  createOwnedOrg,
  acceptInviteAtomically,
  keepOrgActive,
  setMemberRoleWithinLimit,
} from "../plan";
import { sendEmail } from "../email";
import { renderEmail } from "../email-layout";
import { deleteQrLogoMsg, enqueueStorage } from "../storage";
import { uid, referrerHost, validateQrFields, changesQr, linkUrl } from "../util";
import { jsonBodyLimit } from "../body-limit";
import { parseBody, inviteBodySchema } from "../schemas";
import type {
  UserOrg,
  MemberDTO,
  InviteDTO,
  InvitesCreated,
  OrgStats,
  LinkStats,
  SeriesPoint,
  InvitePreview,
  RecentClick,
  ClickUsage,
} from "@/shared/types";
import { monthKey, nextMonthStart } from "@/shared/click-usage";
import { clicksThisMonth } from "../click-caps";
import { INVITABLE_ROLES } from "@/shared/types";
import {
  computeWindows,
  deadLinkRows,
  decayingLinkRows,
  dimensionRows,
  headlineTotals,
  heatmapRows,
  hourSeriesRows,
  lastDayByHour,
  seriesRows,
  topLinkRows,
  utmRows,
} from "../rollups";

export const orgRoutes = new Hono<AppEnv>();
orgRoutes.use("*", jsonBodyLimit());

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

orgRoutes.post("/", requireUser, async (c) => {
  const log = c.get("log");
  const body = await c.req.json<{ name?: string }>();
  const name = requireOrgName(body.name ?? "");
  log.set({ orgName: name, userId: c.var.user!.id });

  const { limits } = await userPlan(c.var.db, c.var.user!.id);

  const orgId = uid();
  const ts = Date.now();
  // Atomic: the owned-org cap is re-checked at write time inside one D1
  // statement, and an org never persists without an owner (see issue #18).
  const created = await createOwnedOrg(c.var.db, c.env, {
    orgId,
    userId: c.var.user!.id,
    name,
    ts,
    ownedOrgLimit: limits.orgs,
  });
  if (!created)
    throw new HTTPException(402, {
      message: "Upgrade to Pro to create more organizations",
      cause: { code: "org_limit" },
    });
  return c.json(
    {
      id: orgId,
      name,
      role: "owner",
      plan: "free",
      qrLogo: "",
      qrStyle: "",
      qrColor: "",
      qrCorner: "",
      qrBg: "",
      qrEyeColor: "",
      qrLogoSize: null,
      defaultDomainId: null,
      locked: false,
      over: {},
      graceEndsAt: null,
    } satisfies UserOrg,
    201,
  );
});

/** Who owns this org. Every owned-org decision belongs to them, whoever is
 * making the request. */
async function orgOwnerId(db: DB, orgId: string): Promise<string | null> {
  const rows = await db
    .select({ userId: schema.orgMembers.userId })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.role, "owner")));
  return rows[0]?.userId ?? null;
}

/**
 * Keeps this org active, and locks whichever other one has to give way (#160).
 *
 * The owner is over their `orgs` cap and picks which one keeps working. The
 * pick is reversible: calling this on the other org swaps them back. Runs on
 * a locked org, which is the whole point, so it opts out of the lock guard.
 */
orgRoutes.post(
  "/:orgId/keep-active",
  requireOrgRole("owner", { allowWhileLocked: true }),
  async (c) => {
    // The org's owner, not the caller: a platform admin passes
    // requireOrgRole("owner") everywhere (see orgRole), and using their id
    // here would unlock a customer's org against the admin's own plan and
    // then lock one of the admin's orgs to pay for it.
    const userId = await orgOwnerId(c.var.db, c.req.param("orgId"));
    if (!userId) throw new HTTPException(404, { message: "Organization not found" });
    const { limits } = await userPlan(c.var.db, userId);
    // One transaction: two requests picking two different locked orgs could
    // otherwise leave the owner with every org locked. See keepOrgActive.
    await keepOrgActive(c.env, {
      orgId: c.req.param("orgId"),
      userId,
      ownedOrgLimit: limits.orgs,
      ts: Date.now(),
    });
    return c.json({ ok: true });
  },
);

type OrgQrPatchBody = {
  qrLogo?: string;
  qrStyle?: string;
  qrColor?: string;
  qrCorner?: string;
  qrBg?: string;
  qrEyeColor?: string;
  qrLogoSize?: number | null;
};

function wantsQrUpdate(body: OrgQrPatchBody): boolean {
  return (
    body.qrLogo !== undefined ||
    body.qrStyle !== undefined ||
    body.qrColor !== undefined ||
    body.qrCorner !== undefined ||
    body.qrBg !== undefined ||
    body.qrEyeColor !== undefined ||
    body.qrLogoSize !== undefined
  );
}

function qrPatchFields(body: OrgQrPatchBody): Partial<typeof schema.orgs.$inferInsert> {
  const set: Partial<typeof schema.orgs.$inferInsert> = {};
  if (body.qrLogo !== undefined) set.qrLogo = body.qrLogo;
  if (body.qrStyle !== undefined) set.qrStyle = body.qrStyle;
  if (body.qrColor !== undefined) set.qrColor = body.qrColor;
  if (body.qrCorner !== undefined) set.qrCorner = body.qrCorner;
  if (body.qrBg !== undefined) set.qrBg = body.qrBg;
  if (body.qrEyeColor !== undefined) set.qrEyeColor = body.qrEyeColor;
  if (body.qrLogoSize !== undefined) set.qrLogoSize = body.qrLogoSize;
  return set;
}

// Matches the client's own cap (src/app/lib/schemas.ts orgNameSchema): the
// server enforces it too, so a caller that bypasses the client's form
// validation can't store an unbounded name (see issue #19).
const ORG_NAME_MAX_LENGTH = 100;

function requireOrgName(name: JsonValue): string {
  const parsed = v.safeParse(v.string(), name);
  if (!parsed.success) throw new HTTPException(400, { message: "Name must be a string" });
  const trimmed = parsed.output.trim();
  if (!trimmed) throw new HTTPException(400, { message: "Name required" });
  if (trimmed.length > ORG_NAME_MAX_LENGTH)
    throw new HTTPException(400, {
      message: `Name must be ${ORG_NAME_MAX_LENGTH} characters or fewer`,
    });
  return trimmed;
}

/** Applies the QR fields onto `set` and returns the logo being replaced (""
 * if none), so a cleared/replaced one can be swept from R2. Throws if QR
 * customization isn't on the org's plan. */
async function applyQrPatch(
  db: DB,
  orgId: string,
  body: OrgQrPatchBody,
  set: Partial<typeof schema.orgs.$inferInsert>,
): Promise<string> {
  validateQrFields(body, orgId);
  // The same rule the link editor's save follows (#162): what the plan gates
  // is a *change* to the styling, not the styling arriving back unchanged
  // alongside an edit to some other field. Org-level and link-level QR behave
  // the same on a downgrade, which they did not before: one 402'd on any QR
  // field being present while the other quietly wiped them.
  const [{ limits }, rows] = await Promise.all([
    orgPlan(db, orgId),
    db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId)),
  ]);
  const existing = rows[0] ?? null;
  if (!limits.qrCustom && changesQr(body, existing))
    throw new HTTPException(402, {
      message: "Changing how QR codes look needs a paid plan",
      cause: { code: "qr_locked" },
    });
  Object.assign(set, qrPatchFields(body));
  if (body.qrLogo === undefined) return "";
  return existing?.qrLogo ?? "";
}

/**
 * The org's default domain for new links (#69).
 *
 * Only a domain this org owns, and only one that is actually serving: an org
 * cannot point new links at somebody else's hostname, and preselecting a
 * domain still waiting on DNS would hand every new link an address that
 * resolves nowhere. Null clears it, back to the shared domain.
 */
async function resolveDefaultDomain(
  db: DB,
  orgId: string,
  domainId: string | null,
): Promise<string | null> {
  if (domainId === null) return null;
  const rows = await db
    .select({ status: schema.domains.status, lockedAt: schema.domains.lockedAt })
    .from(schema.domains)
    .where(and(eq(schema.domains.id, domainId), eq(schema.domains.orgId, orgId)));
  if (!rows.length) throw new HTTPException(404, { message: "Unknown domain" });
  // A locked domain stops serving when the grace period ends, so pointing new
  // links at it would build a backlog of links that die on a known date (#159).
  if (rows[0].lockedAt !== null)
    throw new HTTPException(402, {
      message: "That domain is locked: upgrade to use it again",
      cause: { code: "domain_locked" },
    });
  if (rows[0].status !== "active")
    throw new HTTPException(400, {
      message: "That domain is not serving yet, so it cannot be the default",
    });
  return domainId;
}

orgRoutes.patch("/:orgId", requireOrgRole("admin"), async (c) => {
  const body = await c.req.json<
    { name?: string; defaultDomainId?: string | null } & OrgQrPatchBody
  >();
  const orgId = c.req.param("orgId");
  const db = c.var.db;

  const set: Partial<typeof schema.orgs.$inferInsert> = {};
  if (body.name !== undefined) set.name = requireOrgName(body.name);
  if (body.defaultDomainId !== undefined)
    set.defaultDomainId = await resolveDefaultDomain(db, orgId, body.defaultDomainId);
  const oldLogo = wantsQrUpdate(body) ? await applyQrPatch(db, orgId, body, set) : "";

  if (Object.keys(set).length === 0) throw new HTTPException(400, { message: "Nothing to update" });
  await db.update(schema.orgs).set(set).where(eq(schema.orgs.id, orgId));
  await enqueueStorage(c.env, [
    body.qrLogo !== undefined && body.qrLogo !== oldLogo ? deleteQrLogoMsg(oldLogo) : null,
  ]);
  return c.json({ ok: true });
});

/**
 * Full org teardown, shared with the admin route. Marking the org deleting
 * first closes the gather/d1-delete race: requireOrgRole rejects every
 * org-scoped write from this point on, so nothing can create a link or
 * domain the workflow's gather step never sees. A Cloudflare Workflow then
 * runs the ordered, per-step-retried sequence: capture the org's hostnames
 * and KV keys, delete the org row (D1 cascade), then deprovision Cloudflare
 * hostnames, KV entries, and the R2 logo prefix. Once the instance is
 * created, Workflows runs every step to completion.
 */
const TERMINAL_WORKFLOW_STATUSES = new Set(["errored", "terminated", "complete"]);

/**
 * Is a teardown workflow for this org still doing something?
 *
 * Three answers, not two. `get()` throws both when the instance does not
 * exist and when the lookup itself failed, and Workflows gives no way to tell
 * those apart, so a throw is `null`: we do not know. Reading that as "nothing
 * is running" is what let a lookup failure reopen writes under a teardown
 * that was actually in flight (#52).
 */
async function orgDeleteWorkflowActive(env: Env, orgId: string): Promise<boolean | null> {
  try {
    const status = await (await env.ORG_DELETE.get(orgId)).status();
    return !TERMINAL_WORKFLOW_STATUSES.has(status.status);
  } catch {
    return null;
  }
}

export async function deleteOrg(db: DB, env: Env, orgId: string): Promise<void> {
  await deleteOrgs(db, env, [orgId]);
}

/**
 * Tears down several orgs as one act, for the account deletion that owns them
 * all (#119).
 *
 * One flag-write and one workflow start, not two per org. Starting them one
 * at a time meant a failure on the third left the first two torn down and the
 * caller holding an error for a deletion that did not happen, with no way to
 * tell which orgs had already gone.
 */
/**
 * How long an org may sit flagged `deleting_at` before the sweep treats its
 * teardown as stalled. Long enough that a healthy workflow is never disturbed.
 */
const STALLED_DELETION_AFTER = 60 * 60 * 1000;

/** How many stalled orgs one sweep restarts. Bounded like every other sweep. */
const STALLED_DELETION_LIMIT = 50;

/**
 * Restarts teardowns that are flagged and not running (#52, #119).
 *
 * Two ways an org reaches that state, and neither has anyone to fix it.
 * `createBatch` skips an id already in use whatever that instance's state, so
 * an instance that errored or was terminated without finishing is never
 * replaced by a later DELETE: the org answers 200 and nothing runs. And when
 * a start fails ambiguously, the flag is deliberately left set, which is right
 * for an org somebody can DELETE again and wrong for one whose only member is
 * the account that was being deleted at the time.
 *
 * Restart rather than create, because the id is still in use. A running or
 * queued instance is left strictly alone.
 */
export async function sweepStalledOrgDeletions(
  db: DB,
  env: Env,
  now = Date.now(),
): Promise<number> {
  const stalled = await db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(
      and(
        isNotNull(schema.orgs.deletingAt),
        lt(schema.orgs.deletingAt, now - STALLED_DELETION_AFTER),
      ),
    )
    .orderBy(schema.orgs.deletingAt, schema.orgs.id)
    .limit(STALLED_DELETION_LIMIT);
  if (stalled.length === 0) return 0;

  const restarted = await Promise.all(stalled.map((org) => restartIfStalled(env, org.id)));
  // `deleting_at` is also the durable last-check cursor. Without moving the
  // selected rows forward, 50 old workflows that are still active (or cannot
  // be read) occupy every daily pass and a later missing instance is never
  // reached. The flag stays non-null, so writes remain closed throughout.
  await db
    .update(schema.orgs)
    .set({ deletingAt: now })
    .where(
      inArray(
        schema.orgs.id,
        stalled.map((org) => org.id),
      ),
    );
  return restarted.filter(Boolean).length;
}

/** True if this org's teardown was actually restarted. Never throws: one
 * unreadable instance must not stop the sweep reaching the rest. */
async function restartIfStalled(env: Env, orgId: string): Promise<boolean> {
  // The lookup and the restart are separate try blocks on purpose. Wrapping
  // both meant a restart that failed on an instance which plainly exists was
  // read as "no instance", and the fallback then created for an id already in
  // use: createBatch skipped it and the sweep still reported a restart that
  // never happened.
  let instance;
  let status;
  try {
    instance = await env.ORG_DELETE.get(orgId);
    ({ status } = await instance.status());
  } catch {
    // The lookup failed, which means either no instance or an unreadable one:
    // Workflows gives no way to tell those apart. createBatch settles it,
    // because it skips an id already in use and leaves it out of what it
    // returns. Without reading that, an unreadable live instance was reported
    // as a restart that never happened.
    try {
      const created = await env.ORG_DELETE.createBatch([{ id: orgId, params: { orgId } }]);
      if (created.length === 0) return false;
      captureAlert([{ event: "org_delete_restarted", orgId, status: "missing" }]);
      return true;
    } catch {
      return false;
    }
  }
  if (!TERMINAL_WORKFLOW_STATUSES.has(status)) return false;
  try {
    await instance.restart();
  } catch {
    // It exists and is terminal, so creating is not an option. The next sweep
    // tries again.
    return false;
  }
  captureAlert([{ event: "org_delete_restarted", orgId, status }]);
  return true;
}

export async function deleteOrgs(db: DB, env: Env, orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  const now = Date.now();
  const marked = await db
    .update(schema.orgs)
    .set({ deletingAt: now })
    .where(and(inArray(schema.orgs.id, orgIds), isNull(schema.orgs.deletingAt)))
    .returning({ id: schema.orgs.id });
  await startOrgTeardown(
    db,
    env,
    orgIds,
    marked.map((row) => row.id),
  );
}

/**
 * Starts the teardown workflow for orgs already marked `deleting_at`.
 * `marked` is the ones this caller marked itself, the only flags it may
 * undo if the start fails.
 */
export async function startOrgTeardown(
  db: DB,
  env: Env,
  orgIds: string[],
  marked: string[],
): Promise<void> {
  if (orgIds.length === 0) return;
  try {
    // `createBatch` rather than `create`, because it is documented idempotent:
    // an id already in use is skipped instead of throwing. That is what makes
    // this safe to call on a repeat DELETE, which is the repair path for an
    // org left flagged with nothing driving its teardown.
    await env.ORG_DELETE.createBatch(orgIds.map((orgId) => ({ id: orgId, params: { orgId } })));
  } catch (err) {
    // Only undo a flag when we are certain nothing is running: a terminal
    // instance is proof, an unreadable one is not. Leaving it set costs a
    // read-only org until the next DELETE restarts teardown; clearing it on a
    // guess reopens writes underneath a workflow that has already taken its
    // snapshot, and those writes survive as public redirects for an org that
    // is supposed to be gone. Only the flags this call set are candidates:
    // one it found already set belongs to somebody else's teardown.
    const statuses = await Promise.all(
      marked.map(async (id) => ({ id, active: await orgDeleteWorkflowActive(env, id) })),
    );
    const clearable = statuses.flatMap((s) => (s.active === false ? [s.id] : []));
    if (clearable.length > 0)
      await db
        .update(schema.orgs)
        .set({ deletingAt: null })
        .where(inArray(schema.orgs.id, clearable));
    throw err;
  }
}

// A locked org can still be deleted: deleting it is one of the two ways out
// of the lock, and refusing would trap the owner.
orgRoutes.delete(
  "/:orgId",
  requireOrgRole("owner", { allowWhileDeleting: true, allowWhileLocked: true }),
  async (c) => {
    await deleteOrg(c.var.db, c.env, c.req.param("orgId"));
    return c.json({ ok: true });
  },
);

/* ---------------- members ---------------- */

orgRoutes.get("/:orgId/members", requireOrgRole("viewer"), async (c) => {
  const rows = await c.var.db
    .select({
      userId: schema.orgMembers.userId,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.orgMembers.role,
      createdAt: schema.orgMembers.createdAt,
      previousRole: schema.orgMembers.previousRole,
    })
    .from(schema.orgMembers)
    .innerJoin(schema.user, eq(schema.orgMembers.userId, schema.user.id))
    .where(eq(schema.orgMembers.orgId, c.req.param("orgId")));
  return c.json(
    rows.map(({ previousRole, ...row }) => ({
      ...row,
      demoted: previousRole !== null,
    })) satisfies MemberDTO[],
  );
});

orgRoutes.patch("/:orgId/members/:userId", requireOrgRole("admin"), async (c) => {
  const body = await c.req.json<{ role?: string }>();
  const role = INVITABLE_ROLES.find((r) => r === body.role);
  if (!role) throw new HTTPException(400, { message: "Role must be admin, member or viewer" });
  const { orgId, targetId } = await resolveMember(
    c.var.db,
    c.req.param("orgId"),
    c.req.param("userId"),
  );
  // Guarded inside the statement, not from a count read first: two admins
  // promoting two different viewers at once would both find room. Demoting is
  // always allowed, which is what makes the swap possible.
  const { limits } = await orgPlan(c.var.db, orgId);
  const written = await setMemberRoleWithinLimit(c.env, {
    orgId,
    userId: targetId,
    role,
    memberLimit: limits.members,
  });
  if (!written)
    throw new HTTPException(402, {
      message: `This plan allows ${limits.members} members who can make changes: set someone else to viewer first`,
      cause: { code: "member_limit" },
    });
  return c.json({ ok: true });
});

orgRoutes.delete("/:orgId/members/:userId", requireOrgRole("admin"), async (c) => {
  const { orgId, targetId } = await resolveMember(
    c.var.db,
    c.req.param("orgId"),
    c.req.param("userId"),
  );
  await c.var.db.delete(schema.orgMembers).where(memberWhere(orgId, targetId));
  return c.json({ ok: true });
});

/* ---------------- invites ---------------- */

orgRoutes.get("/:orgId/invites", requireOrgRole("admin"), async (c) => {
  const rows = await c.var.db
    .select({
      token: schema.invites.token,
      role: schema.invites.role,
      email: schema.invites.email,
      createdAt: schema.invites.createdAt,
      expiresAt: schema.invites.expiresAt,
    })
    .from(schema.invites)
    .where(eq(schema.invites.orgId, c.req.param("orgId")))
    .orderBy(desc(schema.invites.createdAt));
  const ts = Date.now();
  return c.json(rows.filter((r) => r.expiresAt > ts) satisfies InviteDTO[]);
});

/** Members + open (unexpired) invites, for the plan member cap. */
async function occupiedSeats(db: AppEnv["Variables"]["db"], orgId: string): Promise<number> {
  const ts = Date.now();
  const [members, pending] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.orgMembers)
      .where(eq(schema.orgMembers.orgId, orgId)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.invites)
      .where(and(eq(schema.invites.orgId, orgId), gte(schema.invites.expiresAt, ts))),
  ]);
  return (members[0]?.n ?? 0) + (pending[0]?.n ?? 0);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

orgRoutes.post("/:orgId/invites", requireOrgRole("admin"), async (c) => {
  let rawBody: JsonValue;
  try {
    rawBody = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid request body" });
  }
  const body = parseBody(inviteBodySchema, rawBody);
  const role = body.role;
  const orgIdParam = c.req.param("orgId");
  const { plan, limits } = await orgPlan(c.var.db, orgIdParam);

  const emails = [
    ...new Set(
      body.emails.flatMap((e) => {
        const email = e.trim().toLowerCase();
        return EMAIL_RE.test(email) ? [email] : [];
      }),
    ),
  ];
  // An address that already has an open invite keeps it: asking again sends
  // the same link (with this role and a fresh week) rather than a second
  // row, so retrying after a failed send never duplicates an invite.
  const ts = Date.now();
  const open = emails.length
    ? await c.var.db
        .select({ token: schema.invites.token, email: schema.invites.email })
        .from(schema.invites)
        .where(
          and(
            eq(schema.invites.orgId, orgIdParam),
            inArray(schema.invites.email, emails),
            gte(schema.invites.expiresAt, ts),
          ),
        )
    : [];
  const openToken = new Map(open.map((o) => [o.email, o.token]));
  const fresh = emails.filter((e) => !openToken.has(e));
  const need = emails.length === 0 ? 1 : fresh.length;
  if (need > 0 && (await occupiedSeats(c.var.db, orgIdParam)) + need > limits.members)
    throw new HTTPException(402, {
      message:
        plan === "free"
          ? `The free plan allows ${limits.members} members (including you), upgrade to a paid plan to invite more`
          : `This plan allows at most ${limits.members} members`,
    });

  if (emails.length === 0) {
    const invite = {
      token: uid(24),
      orgId: orgIdParam,
      role,
      email: null,
      createdBy: c.var.user!.id,
      createdAt: ts,
      expiresAt: ts + INVITE_TTL_MS,
    } as const;
    await c.var.db.insert(schema.invites).values(invite);
    return c.json(
      {
        invites: [
          {
            token: invite.token,
            role,
            email: invite.email,
            createdAt: invite.createdAt,
            expiresAt: invite.expiresAt,
          } satisfies InviteDTO,
        ],
        failed: [],
      } satisfies InvitesCreated,
      201,
    );
  }

  const orgRows = await c.var.db
    .select({ name: schema.orgs.name })
    .from(schema.orgs)
    .where(eq(schema.orgs.id, orgIdParam));
  const orgName = orgRows[0]?.name ?? "rdyrct";

  const created = emails.map((email) => ({
    token: openToken.get(email) ?? uid(24),
    orgId: orgIdParam,
    role,
    email,
    createdBy: c.var.user!.id,
    createdAt: ts,
    expiresAt: ts + INVITE_TTL_MS,
  }));

  const inserts = created.filter((invite) => !openToken.has(invite.email));
  if (inserts.length) await c.var.db.insert(schema.invites).values(inserts);
  if (openToken.size)
    await c.var.db
      .update(schema.invites)
      .set({ role, expiresAt: ts + INVITE_TTL_MS })
      .where(
        and(
          eq(schema.invites.orgId, orgIdParam),
          inArray(schema.invites.token, [...openToken.values()]),
        ),
      );

  // Every address gets its try: one bounce must not hide which others went
  // out. The rows stay either way, so the dialog can offer the failed ones
  // again and the retry lands on the same invite.
  const sends = await Promise.allSettled(
    created.map((invite) =>
      sendEmail(
        c.env,
        invite.email,
        `You're invited to ${orgName} on rdyrct`,
        renderEmail(
          {
            preheader: `Join ${orgName} on rdyrct. The invite lasts 7 days.`,
            heading: `You're invited to join ${orgName}`,
            paragraphs: ["rdyrct shortens links and makes QR codes for them."],
            cta: {
              label: "Accept the invite",
              url: `${c.env.APP_URL}/invite/${invite.token}`,
            },
            note: "The invite expires in 7 days.",
          },
          c.env.APP_URL,
          invite.email,
        ),
      ),
    ),
  );
  const failed = created.flatMap((invite, i) =>
    sends[i]!.status === "rejected" ? [invite.email] : [],
  );
  const firstFailure = sends.find((s) => s.status === "rejected");
  if (firstFailure?.status === "rejected") {
    const log = c.get("log");
    // Counts only: the addresses are personal data.
    log?.set({ invites: { failed: failed.length, sent: created.length - failed.length } });
    const err = firstFailure.reason;
    log?.error(err instanceof Error ? err : new Error(String(err)));
  }

  return c.json(
    {
      failed,
      invites: created.map(
        (invite) =>
          ({
            token: invite.token,
            role,
            email: invite.email,
            createdAt: invite.createdAt,
            expiresAt: invite.expiresAt,
          }) satisfies InviteDTO,
      ),
    } satisfies InvitesCreated,
    201,
  );
});

orgRoutes.delete("/:orgId/invites/:token", requireOrgRole("admin"), async (c) => {
  await c.var.db
    .delete(schema.invites)
    .where(
      and(
        eq(schema.invites.token, c.req.param("token")),
        eq(schema.invites.orgId, c.req.param("orgId")),
      ),
    );
  return c.json({ ok: true });
});

/** How many expired invites one sweep statement retires at a time. */
const INVITE_SWEEP_CHUNK = 500;

/**
 * Drops invites nobody opened before they expired (#103).
 *
 * An accepted invite is already deleted at accept time, so this is the other
 * half: no token and no invited address outlives the week it was good for.
 * Bounded batches for the same reason the click trim uses them, even though
 * an org's open invites are capped by its member limit.
 */
export async function sweepExpiredInvites(env: Env): Promise<number> {
  const stmt = env.DB.prepare(
    `delete from invites where token in (
       select token from invites where expires_at < ? limit ?
     )`,
  );
  let deleted = 0;
  let changes = 0;
  do {
    changes = (await stmt.bind(Date.now(), INVITE_SWEEP_CHUNK).run()).meta.changes;
    deleted += changes;
  } while (changes > 0);
  return deleted;
}

/* ---------------- stats helpers ---------------- */

function emptySeries(days: number): Map<string, number> {
  const map = new Map<string, number>();
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    map.set(d.toISOString().slice(0, 10), 0);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return map;
}

export function fillSeries(rows: { day: string; clicks: number }[], days: number): SeriesPoint[] {
  const map = emptySeries(days);
  for (const r of rows) if (map.has(r.day)) map.set(r.day, r.clicks);
  return [...map.entries()].map(([day, clicks]) => ({ day, clicks }));
}

function emptyHours(): Map<string, number> {
  const map = new Map<string, number>();
  const hourMs = 60 * 60 * 1000;
  const start = Math.floor((Date.now() - 23 * hourMs) / hourMs) * hourMs;
  for (let i = 0; i < 24; i++) {
    const d = new Date(start + i * hourMs);
    const label = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 13)}:00`;
    map.set(label, 0);
  }
  return map;
}

function fillHours(rows: { hour: string; clicks: number }[]): SeriesPoint[] {
  const map = emptyHours();
  for (const r of rows) if (map.has(r.hour)) map.set(r.hour, r.clicks);
  return [...map.entries()].map(([day, clicks]) => ({ day, clicks }));
}

/** A figure against the figure before it, and the change between them.
 * `pct` is null when there is no earlier figure to compare against. */
export interface Delta {
  current: number;
  previous: number;
  pct: number | null;
}

export function computeDelta(current: number, previous: number): Delta {
  return {
    current,
    previous,
    pct: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
  };
}

function cleanDim(rows: { key: string; clicks: number }[]) {
  return rows.map((r) => ({ key: r.key || "direct", clicks: r.clicks }));
}

function clampDays(requested: number | null, planDays: number): number {
  if (!requested || requested < 1) return planDays;
  return Math.min(requested, planDays);
}

async function resolveMember(db: DB, orgId: string, targetId: string) {
  await assertMember(db, orgId, targetId);
  return { orgId, targetId };
}

function memberWhere(orgId: string, targetId: string) {
  return and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, targetId));
}

async function assertMember(
  db: DB,
  orgId: string,
  targetId: string,
): Promise<Exclude<Awaited<ReturnType<typeof orgRole>>, null>> {
  const target = await orgRole(
    db,
    {
      id: targetId,
      email: "",
      name: "",
      isAdmin: false,
      emailVerified: false,
      plan: "free",
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
      polarSubscriptionInterval: null,
      image: null,
    },
    orgId,
  );
  if (!target) throw new HTTPException(404, { message: "Not a member" });
  if (target === "owner") throw new HTTPException(400, { message: "Cannot change the owner" });
  return target;
}

async function lookupInvite(db: DB, token: string) {
  const rows = await db.select().from(schema.invites).where(eq(schema.invites.token, token));
  const invite = rows[0];
  if (!invite || invite.expiresAt < Date.now())
    throw new HTTPException(404, { message: "Invite not found or expired" });
  return invite;
}

orgRoutes.get("/:orgId/stats", requireOrgRole("viewer"), async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId");
  const { limits } = await orgPlan(db, orgId);
  const queryDays = c.req.query("days");
  const bucketRaw = c.req.query("bucket");
  const bucket: "day" | "hour" = bucketRaw === "hour" ? "hour" : "day";
  let days = clampDays(queryDays ? parseInt(queryDays, 10) : null, limits.analyticsDays);
  if (bucket === "hour") days = 1;
  const w = computeWindows(days);
  const scope = { orgId };

  const [
    headline,
    lastDay,
    seriesData,
    hourSeriesData,
    topLinks,
    countries,
    referrers,
    devices,
    linkCount,
    deadLinks,
    decayingRaw,
    heatmap,
    campaignRows,
    sourceRows,
    mediumRows,
  ] = await Promise.all([
    // Bounded to the selected range (matching the previous period's
    // equal-length window), not an all-time count: comparing an ever-growing
    // total against one period's worth of prior clicks used to produce a
    // meaningless delta (see issue #24).
    headlineTotals(db, scope, w),
    lastDayByHour(db, orgId, w.since24h),
    seriesRows(db, scope, w.since),
    hourSeriesRows(db, orgId, w.since24h),
    topLinkRows(db, orgId),
    dimensionRows(db, scope, w.since, "country", 10),
    dimensionRows(db, scope, w.since, "referrer", 8),
    dimensionRows(db, scope, w.since, "device"),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.links)
      .where(eq(schema.links.orgId, orgId)),
    deadLinkRows(db, orgId, w.since30),
    decayingLinkRows(c.env, orgId, w),
    heatmapRows(db, orgId, w.sinceMs),
    utmRows(db, orgId, w.since, "utmCampaign"),
    utmRows(db, orgId, w.since, "utmSource"),
    utmRows(db, orgId, w.since, "utmMedium"),
  ]);
  const { clicks7d, clicks7dPrev } = headline;
  // The 24-hour view counts the 24 hours its chart draws, not today's UTC day.
  const { totalClicks, totalClicksPrev } = bucket === "hour" ? lastDay : headline;

  return c.json({
    totalClicks,
    totalLinks: linkCount[0]?.n ?? 0,
    clicks7d,
    rangeDays: days,
    bucket,
    series: fillSeries(seriesData, days),
    hourSeries: fillHours(hourSeriesData),
    totalClicksDelta: computeDelta(totalClicks, totalClicksPrev),
    clicks7dDelta: computeDelta(clicks7d, clicks7dPrev),
    topLinks,
    countries: cleanDim(countries).map((r) => ({
      ...r,
      key: r.key === "direct" ? "unknown" : r.key,
    })),
    referrers: cleanDim(referrers).map((r) => ({
      ...r,
      key: r.key ? referrerHost(r.key) || r.key : "direct",
    })),
    devices: cleanDim(devices),
    deadLinks: deadLinks.map((l) => ({ id: l.id, slug: l.slug, title: l.title })),
    decayingLinks: decayingRaw.map((l) => ({
      id: l.id,
      slug: l.slug,
      title: l.title,
      drop: l.drop_pct,
    })),
    heatmap,
    campaigns: campaignRows.map((r) => ({ campaign: r.value, clicks: r.clicks })),
    sources: sourceRows.map((r) => ({ source: r.value, clicks: r.clicks })),
    mediums: mediumRows.map((r) => ({ medium: r.value, clicks: r.clicks })),
  } satisfies OrgStats);
});

/* ---------------- recent clicks feed (dashboard) ---------------- */

orgRoutes.get("/:orgId/clicks", requireOrgRole("viewer"), async (c) => {
  const raw = parseInt(c.req.query("limit") ?? "", 10);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 8, 1), 50);
  const rows = await c.var.db
    .select({
      id: schema.clicks.id,
      ts: schema.clicks.ts,
      country: schema.clicks.country,
      referrer: schema.clicks.referrer,
      device: schema.clicks.device,
      slug: schema.links.slug,
      domain: schema.domains.hostname,
    })
    .from(schema.clicks)
    .innerJoin(schema.links, eq(schema.clicks.linkId, schema.links.id))
    .leftJoin(schema.domains, eq(schema.links.domainId, schema.domains.id))
    .where(eq(schema.clicks.orgId, c.req.param("orgId")))
    .orderBy(desc(schema.clicks.ts))
    .limit(limit);
  return c.json(
    rows.map((r) => ({
      ...r,
      referrer: r.referrer ? referrerHost(r.referrer) || r.referrer : "",
    })) satisfies RecentClick[],
  );
});

/* ---------------- tracked clicks this month (#387) ---------------- */

orgRoutes.get("/:orgId/click-usage", requireOrgRole("viewer"), async (c) => {
  const orgId = c.req.param("orgId");
  const now = Date.now();
  const [{ limits }, clicks] = await Promise.all([
    orgPlan(c.var.db, orgId),
    clicksThisMonth(c.env, orgId, now),
  ]);
  c.get("log")?.set({ orgId, clickUsage: { clicks, limit: limits.trackedClicks } });
  return c.json({
    month: monthKey(now),
    clicks,
    limit: limits.trackedClicks,
    resetsAt: nextMonthStart(now),
  } satisfies ClickUsage);
});

/* ---------------- per-link stats ---------------- */

orgRoutes.get("/:orgId/links/stats/:slug", requireOrgRole("viewer"), async (c) => {
  const db = c.var.db;
  const orgId = c.req.param("orgId");
  const slug = c.req.param("slug");
  const domain = c.req.query("domain");
  const { limits } = await orgPlan(db, orgId);
  const days = limits.analyticsDays;

  // Matched through link_addresses (any active address, not just the link's
  // current primary), so a bookmarked or QR'd URL for an address that has
  // since become a rename alias still lands on the right link (see #38).
  const conditions = [
    eq(schema.linkAddresses.slug, slug),
    eq(schema.linkAddresses.orgId, orgId),
    isNull(schema.linkAddresses.retiredAt),
  ];
  if (domain) conditions.push(eq(schema.domains.hostname, domain));

  const [link] = await db
    .select({
      id: schema.links.id,
      slug: schema.links.slug,
      destination: schema.links.destination,
      title: schema.links.title,
      createdAt: schema.links.createdAt,
      createdBy: schema.links.createdBy,
      domain: schema.domains.hostname,
    })
    .from(schema.linkAddresses)
    .innerJoin(schema.links, eq(schema.linkAddresses.linkId, schema.links.id))
    .leftJoin(schema.domains, eq(schema.linkAddresses.domainId, schema.domains.id))
    .where(and(...conditions))
    .orderBy(sql`case when ${schema.linkAddresses.domainId} is null then 0 else 1 end`)
    .limit(1);

  if (!link) throw new HTTPException(404, { message: "Link not found" });

  const linkId = link.id;
  const w = computeWindows(days);
  const scope = { linkId };

  const [headline, seriesData, countries, referrers, devices, lastClickRow] = await Promise.all([
    // Bounded to the selected range, same reasoning as the org stats route's
    // headline figures above (see issue #24).
    headlineTotals(db, scope, w),
    seriesRows(db, scope, w.since),
    dimensionRows(db, scope, w.since, "country", 10),
    dimensionRows(db, scope, w.since, "referrer", 8),
    dimensionRows(db, scope, w.since, "device"),
    // The one raw read left: a single row off the (link_id, ts) index, for a
    // timestamp the rollups only know to the hour.
    db
      .select({ ts: schema.clicks.ts })
      .from(schema.clicks)
      .where(eq(schema.clicks.linkId, linkId))
      .orderBy(desc(schema.clicks.ts))
      .limit(1),
  ]);
  const { totalClicks, totalClicksPrev, clicks7d, clicks7dPrev } = headline;

  return c.json({
    id: link.id,
    totalClicks,
    clicks7d,
    rangeDays: days,
    series: fillSeries(seriesData, days),
    totalClicksDelta: computeDelta(totalClicks, totalClicksPrev),
    clicks7dDelta: computeDelta(clicks7d, clicks7dPrev),
    countries: cleanDim(countries).map((r) => ({
      ...r,
      key: r.key === "direct" ? "unknown" : r.key,
    })),
    referrers: cleanDim(referrers).map((r) => ({
      ...r,
      key: r.key ? referrerHost(r.key) || r.key : "direct",
    })),
    devices: cleanDim(devices),
    slug: link.slug,
    domain: link.domain,
    url: linkUrl(c.env, link.domain, link.slug),
    destination: link.destination,
    title: link.title,
    createdAt: link.createdAt,
    lastClick: lastClickRow[0]?.ts ?? null,
    createdBy: link.createdBy,
  } satisfies LinkStats);
});

/* ---------------- invite acceptance (not org-scoped) ---------------- */

export const inviteRoutes = new Hono<AppEnv>();
inviteRoutes.use("*", jsonBodyLimit());

inviteRoutes.get("/:token", async (c) => {
  const log = c.get("log");
  const token = c.req.param("token");
  log.set({ token });
  const rows = await c.var.db
    .select({
      role: schema.invites.role,
      expiresAt: schema.invites.expiresAt,
      orgName: schema.orgs.name,
    })
    .from(schema.invites)
    .innerJoin(schema.orgs, eq(schema.invites.orgId, schema.orgs.id))
    .where(eq(schema.invites.token, c.req.param("token")));
  const invite = rows[0];
  if (!invite || invite.expiresAt < Date.now())
    throw new HTTPException(404, { message: "Invite not found or expired" });
  log.audit({
    action: "invite.view",
    actor: { type: "user", id: c.get("user")?.id ?? "anonymous" },
    target: { type: "invite", id: token },
    outcome: "success",
  });
  return c.json({
    orgName: invite.orgName,
    role: invite.role,
  } satisfies InvitePreview);
});

/**
 * Always throws: says why the guarded insert wrote nothing.
 *
 * The statement refuses for three reasons and reports none of them, so each
 * is read back here, in the order that answers the caller honestly. The token
 * comes last because it is the rarest and the only one that needs a second
 * read of a row we already had.
 */
async function explainRefusedInvite(
  db: DB,
  invite: typeof schema.invites.$inferSelect,
  userId: string,
): Promise<never> {
  const [existing, live] = await Promise.all([
    db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, invite.orgId), eq(schema.orgMembers.userId, userId))),
    db
      .select({ token: schema.invites.token })
      .from(schema.invites)
      .where(eq(schema.invites.token, invite.token)),
  ]);
  if (existing.length) throw new HTTPException(409, { message: "Already a member of this org" });
  // Somebody else spent the link between the lookup above and the insert. It
  // has to read as an unknown token, not as a full org: the org may have room.
  if (!live.length) throw new HTTPException(404, { message: "Invite not found or expired" });
  throw new HTTPException(402, { message: "This organization is full on its current plan" });
}

inviteRoutes.post("/:token/accept", requireUser, async (c) => {
  const log = c.get("log");
  const token = c.req.param("token");
  log.set({ token });
  const db = c.var.db;
  const invite = await lookupInvite(db, c.req.param("token"));

  // Email invites are bound to the address they were sent to; link invites
  // (email null) are bearer links anyone signed in can accept.
  if (invite.email && invite.email !== c.var.user!.email.toLowerCase())
    throw new HTTPException(403, {
      message:
        "This invite was sent to a different email address: sign in with the invited account",
    });

  // The cap may have been reached (or the plan downgraded) since the invite
  // was created; recheck against actual members at accept time. That recheck,
  // the "already a member" check and the token itself are all read inside one
  // atomic statement (see #18 and #154), which spends the invite in the same
  // transaction: two concurrent accepts of one link cannot both pass.
  const { limits } = await orgPlan(db, invite.orgId);
  const accepted = await acceptInviteAtomically(c.env, {
    orgId: invite.orgId,
    userId: c.var.user!.id,
    role: invite.role,
    ts: Date.now(),
    memberLimit: limits.members,
    token: invite.token,
  });
  if (!accepted) await explainRefusedInvite(db, invite, c.var.user!.id);
  log.audit({
    action: "invite.accept",
    actor: { type: "user", id: c.var.user!.id },
    target: { type: "invite", id: token },
    outcome: "success",
  });
  return c.json({ orgId: invite.orgId });
});
