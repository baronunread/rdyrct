import { Hono } from "hono";
import { planNow } from "../plan";
import { emailConfigured } from "../email";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { sharedLinkHost } from "../util";
import { servedSiteKey } from "../turnstile";
import { requireUser } from "../guards";
import { jsonBodyLimit } from "../body-limit";
import type { AppConfig, CurrentUser } from "@/shared/types";
import { orgPlanOf } from "@/shared/types";
import { effectiveLimits, tierOf } from "@/shared/limits";
import { loadLimitOverrides } from "../limit-overrides";
import { parseOver } from "../reconcile";
import { consentColumns, marketingStateOf, setMarketing } from "../marketing";
import { newsletterConfigured } from "../newsletter";
import { marketingBodySchema, parseBody } from "../schemas";
import type { JsonValue } from "@/shared/types";

export const userRoutes = new Hono<AppEnv>();
userRoutes.use("*", jsonBodyLimit());

async function currentUserFor(
  db: AppEnv["Variables"]["db"],
  user: NonNullable<AppEnv["Variables"]["user"]>,
  marketingOffered: boolean,
): Promise<CurrentUser> {
  // An org's effective plan is its OWNER's, so join through the owner membership.
  const ownerMember = alias(schema.orgMembers, "owner_member");
  const ownerUser = alias(schema.user, "owner_user");
  const [rows, billingRows] = await Promise.all([
    db
      .select({
        id: schema.orgs.id,
        name: schema.orgs.name,
        role: schema.orgMembers.role,
        ownerPlan: ownerUser.plan,
        ownerId: ownerUser.id,
        qrLogo: schema.orgs.qrLogo,
        qrStyle: schema.orgs.qrStyle,
        qrColor: schema.orgs.qrColor,
        qrCorner: schema.orgs.qrCorner,
        qrBg: schema.orgs.qrBg,
        qrEyeColor: schema.orgs.qrEyeColor,
        qrLogoSize: schema.orgs.qrLogoSize,
        defaultDomainId: schema.orgs.defaultDomainId,
        lockedAt: schema.orgs.lockedAt,
        overJson: schema.orgEntitlements.overJson,
        graceEndsAt: schema.orgEntitlements.graceEndsAt,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.orgs, eq(schema.orgMembers.orgId, schema.orgs.id))
      .leftJoin(schema.orgEntitlements, eq(schema.orgEntitlements.orgId, schema.orgs.id))
      .leftJoin(
        ownerMember,
        and(eq(ownerMember.orgId, schema.orgs.id), eq(ownerMember.role, "owner")),
      )
      .leftJoin(ownerUser, eq(ownerMember.userId, ownerUser.id))
      .where(eq(schema.orgMembers.userId, user.id)),
    // Not on the session: adding these columns as BetterAuth additional fields would
    // carry a provider id through every request.
    db
      .select({
        customerId: schema.user.polarCustomerId,
        compPlan: schema.user.compPlan,
        ...consentColumns,
      })
      .from(schema.user)
      .where(eq(schema.user.id, user.id)),
  ]);

  const overrides = await loadLimitOverrides(db, [
    user.id,
    ...rows.flatMap((r) => (r.ownerId ? [r.ownerId] : [])),
  ]);
  const orgs = rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    plan: planNow(orgPlanOf(r.ownerPlan)),
    tier: tierOf(planNow(orgPlanOf(r.ownerPlan)), r.ownerId ? overrides.get(r.ownerId) : undefined),
    limits: effectiveLimits(
      planNow(orgPlanOf(r.ownerPlan)),
      r.ownerId ? overrides.get(r.ownerId) : undefined,
    ),
    qrLogo: r.qrLogo,
    qrStyle: r.qrStyle,
    qrColor: r.qrColor,
    qrCorner: r.qrCorner,
    qrBg: r.qrBg,
    qrEyeColor: r.qrEyeColor,
    qrLogoSize: r.qrLogoSize,
    defaultDomainId: r.defaultDomainId,
    locked: r.lockedAt != null,
    over: parseOver(r.overJson ?? "{}"),
    graceEndsAt: r.graceEndsAt,
  }));
  return {
    user: {
      ...user,
      tier: tierOf(planNow(orgPlanOf(user.plan)), overrides.get(user.id)),
      limits: effectiveLimits(planNow(orgPlanOf(user.plan)), overrides.get(user.id)),
      hasBillingAccount: Boolean(billingRows[0]?.customerId),
      comped: Boolean(billingRows[0]?.compPlan),
      marketing: marketingStateOf(
        billingRows[0] ?? { newsOptInAt: null, offersOptInAt: null, marketingAskedAt: null },
      ),
      marketingOffered,
    },
    orgs,
  };
}

userRoutes.get("/user", requireUser, async (c) => {
  const log = c.get("log");
  log.set({ userId: c.var.user!.id });
  return c.json(await currentUserFor(c.var.db, c.var.user!, newsletterConfigured(c.env)));
});

// Consent is personal data, so every change is audited, never with the address.
userRoutes.put("/user/marketing", requireUser, async (c) => {
  const log = c.get("log");
  const user = c.var.user!;
  const body = parseBody(marketingBodySchema, await c.req.json<JsonValue>().catch(() => null));
  const { state, applied } = await setMarketing(c.var.db, user.id, body);
  log.set({ marketing: { source: body.source, news: body.news, offers: body.offers, applied } });
  log.audit({
    action: "marketing.consent",
    actor: { type: "user", id: user.id },
    target: { type: "user", id: user.id },
    outcome: applied ? "success" : "denied",
  });
  return c.json(state);
});

userRoutes.get("/config", (c) => {
  const log = c.get("log");
  log.set({ route: "config" });
  return c.json({
    appHost: c.env.APP_HOST,
    linkHost: sharedLinkHost(c.env),
    emailEnabled: emailConfigured(c.env),
    googleEnabled: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    // Only when the check is on: a lone site key would render a widget nobody checks.
    turnstileSiteKey: servedSiteKey(c.env),
  } satisfies AppConfig);
});
