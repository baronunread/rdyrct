import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/* ---------------- BetterAuth-managed tables ---------------- */
// Shapes follow the BetterAuth core schema (bunx @better-auth/cli generate),
// plus our additional `isAdmin` field on user.

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  // Suspended by a platform admin: sessions are wiped and sign-in is refused.
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  // Billing lives on the user, not the org: one Free/Hobby/Pro subscription
  // per person. An org's effective limits are its owner's plan (see plan.ts).
  //
  // DERIVED. `plan` is what the user may do, and it is coalesce(comp_plan,
  // entitling subscription_plan, 'free'). Only entitlement.ts writes it, and
  // it always writes it from the two columns below in the same statement.
  // Anything that sets it by hand puts entitlement out of step with billing,
  // which is the bug #81 fixed.
  plan: text("plan", { enum: ["free", "hobby", "pro"] })
    .notNull()
    .default("free"),
  // What Polar says: written by the webhook, never by an admin. Null means no
  // subscription. `subscriptionStatus` is Polar's own status string, kept raw
  // so a status we have no rule for is still visible (see entitlement.ts).
  subscriptionPlan: text("subscription_plan", { enum: ["hobby", "pro"] }),
  subscriptionStatus: text("subscription_status"),
  // No price here on purpose (#82). Polar knows what it charged, net of
  // discounts, tax and refunds, so revenue is read in its dashboard. A copy
  // kept here would be a second figure to keep true, and the wrong one to
  // trust when the two disagree.
  //
  // What an admin granted by hand: written by the comp routes, never by a
  // webhook. A comp outranks the subscription, so revoking a subscription
  // cannot take away access an admin gave.
  compPlan: text("comp_plan", { enum: ["hobby", "pro"] }),
  compGrantedBy: text("comp_granted_by"),
  compGrantedAt: integer("comp_granted_at", { mode: "timestamp_ms" }),
  compReason: text("comp_reason"),
  polarCustomerId: text("polar_customer_id"),
  polarSubscriptionId: text("polar_subscription_id"),
  polarSubscriptionCancelAtPeriodEnd: integer("polar_subscription_cancel_at_period_end", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  polarSubscriptionCurrentPeriodEnd: integer("polar_subscription_current_period_end", {
    mode: "timestamp_ms",
  }),
  // When the subscription state these columns reflect was last changed at
  // Polar (its `modified_at`, or `created_at` before a first change). Every
  // webhook mutation refuses to write over a newer value, which is what
  // makes a late or replayed delivery harmless. See routes/billing.ts.
  polarEventAt: integer("polar_event_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_session_user").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_account_user").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_verification_identifier").on(t.identifier)],
);

/* ---------------- app tables ---------------- */

function qrColumns() {
  return {
    qrLogo: text("qr_logo").notNull().default(""),
    qrStyle: text("qr_style").notNull().default(""),
    qrColor: text("qr_color").notNull().default(""),
    qrCorner: text("qr_corner").notNull().default(""),
    qrBg: text("qr_bg").notNull().default(""),
    qrEyeColor: text("qr_eye_color").notNull().default(""),
    qrLogoSize: real("qr_logo_size"),
  } as const;
}

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // No plan/billing columns: an org's plan is its owner's plan (plan.ts).
  ...qrColumns(),
  // Which domain new links start on (#69). The foreign key and its ON DELETE
  // SET NULL live in migration 0018; declaring the reference here too would
  // need a lazy callback, because `domains` is defined below and already
  // references this table.
  defaultDomainId: text("default_domain_id"),
  createdAt: integer("created_at").notNull(),
  // Set right before the teardown workflow starts, so requireOrgRole can
  // reject writes before the workflow's gather step ever runs. Null means
  // not deleting.
  deletingAt: integer("deleting_at"),
  // This org is beyond its owner's `orgs` cap, so it is read-only until they
  // upgrade or pick it as the one to keep (#160). Null means active. Its
  // links keep redirecting: the lock is between us and the account holder.
  lockedAt: integer("locked_at"),
});

/**
 * What the last reconciliation pass found for one org (#158).
 *
 * Written only by reconcile.ts, on every billing event that changes a plan
 * and by the admin's manual run. Read by the app to explain the state and by
 * the daily cron to send the day-23 warning. Nothing here decides access on
 * its own: the marker columns (`orgs.lockedAt`, `domains.lockedAt`,
 * `orgMembers.previousRole`) are what routes and the redirect path read.
 */
export const orgEntitlements = sqliteTable(
  "org_entitlements",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => orgs.id, { onDelete: "cascade" }),
    plan: text("plan", { enum: ["free", "hobby", "pro"] }).notNull(),
    /** JSON `{ links?: n, members?: n, domains?: n }`: the live count of each
     * resource that is over its cap. `{}` means the org is inside its plan. */
    overJson: text("over_json").notNull().default("{}"),
    /** Epoch ms the 30 days run out; null while nothing is over. */
    graceEndsAt: integer("grace_ends_at"),
    reconciledAt: integer("reconciled_at").notNull(),
    notifiedAt: integer("notified_at"),
    warnedAt: integer("warned_at"),
  },
  (t) => [index("idx_org_entitlements_grace").on(t.graceEndsAt)],
);

export const orgMembers = sqliteTable(
  "org_members",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] }).notNull(),
    // What this member was before a downgrade demoted them to viewer (#161).
    // Null means they hold the role they were given. Re-upgrading restores it.
    previousRole: text("previous_role", { enum: ["owner", "admin", "member", "viewer"] }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("idx_org_members_user").on(t.userId)],
);

export const invites = sqliteTable(
  "invites",
  {
    token: text("token").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "member", "viewer"] }).notNull(),
    // Set when the invite was emailed to a specific address: only that
    // account may accept. Null for copy-only link invites (bearer links).
    email: text("email"),
    // nullable: keep invites/links around if their author is deleted
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_invites_org").on(t.orgId)],
);

export const domains = sqliteTable(
  "domains",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull().unique(),
    status: text("status", { enum: ["checking_dns", "issuing_tls", "active", "error"] })
      .notNull()
      .default("checking_dns"),
    // Human-readable reason a domain sits in `error` (DNS never resolved, cert
    // never issued). Empty for every other status. Surfaced to users and admins.
    statusReason: text("status_reason").notNull().default(""),
    rootRedirect: text("root_redirect").notNull().default(""),
    cfHostnameId: text("cf_hostname_id"),
    // Beyond the org's `domains` cap after a downgrade (#159). It keeps
    // serving until the org's grace period ends, then stops; the row, the KV
    // entry and the Cloudflare hostname all stay, so an upgrade restores it
    // with no re-verification. Null means fine.
    lockedAt: integer("locked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_domains_org").on(t.orgId)],
);

export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // null = the shared default domain. Slug uniqueness is per-domain via the
    // raw unique index idx_links_domain_slug on (ifnull(domain_id,''), slug)
    // (created in migrations; drizzle cannot express ifnull indexes).
    domainId: text("domain_id").references(() => domains.id),
    slug: text("slug").notNull(),
    destination: text("destination").notNull(),
    title: text("title").notNull().default(""),
    utmSource: text("utm_source").notNull().default(""),
    utmMedium: text("utm_medium").notNull().default(""),
    utmCampaign: text("utm_campaign").notNull().default(""),
    utmTerm: text("utm_term").notNull().default(""),
    utmContent: text("utm_content").notNull().default(""),
    ...qrColumns(),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    // Destination risk (#68). Null means unscored, never clean: a provider
    // outage and a clean answer must not look the same. Admin-only (#67),
    // never in an org-scoped response.
    riskScore: integer("risk_score"),
    riskReasons: text("risk_reasons"),
    riskCheckedAt: integer("risk_checked_at"),
    riskProvider: text("risk_provider"),
    // Admin moderation (#67). Null means active. One flag covers every
    // address the link answers to, and the redirect stops because
    // desiredKvValue refuses to publish a suspended link's key: put the
    // check anywhere else and the next edit un-suspends it in silence.
    suspendedAt: integer("suspended_at"),
    suspendedBy: text("suspended_by").references(() => user.id, { onDelete: "set null" }),
    suspendReason: text("suspend_reason"),
  },
  (t) => [index("idx_links_org").on(t.orgId)],
);

/**
 * Every privileged mutation an admin makes, appended and never updated (#67).
 *
 * No foreign keys: an admin account can be deleted, and the record of what
 * they did has to outlive them. The same goes for target_id, which often
 * points at exactly the row this entry exists to remember the deletion of.
 */
export const adminActions = sqliteTable(
  "admin_actions",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    /** e.g. "link.suspend", "org.suspend_links", "user.ban". */
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    /** Free-form JSON, so an entry still reads once its target is gone. */
    detail: text("detail"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_admin_actions_created").on(t.createdAt),
    index("idx_admin_actions_target").on(t.targetType, t.targetId),
  ],
);

// Every address a link answers to, including its own primary as a row kept
// in sync with links.domainId/slug (see routes/links.ts). Slug uniqueness
// lives on the active subset of this table (idx_link_addresses_domain_slug_active,
// a partial index migrations must create; drizzle cannot express partial
// indexes), not on `links` itself, so a renamed-away slug can keep working as
// a retired-later temp_alias without colliding with the link's new primary.
export const linkAddresses = sqliteTable(
  "link_addresses",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    domainId: text("domain_id").references(() => domains.id),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: ["primary", "temp_alias", "permanent_alias"] }).notNull(),
    creationReason: text("creation_reason", {
      enum: ["created", "renamed", "promoted", "same_destination_merge", ""],
    })
      .notNull()
      .default(""),
    // Null = never expires (primary, permanent_alias). Set only on temp_alias.
    expiresAt: integer("expires_at"),
    // Null = active. Set once, by "Remove now" or the expiry sweep, and never
    // cleared: the row stays for its historical clicks.
    retiredAt: integer("retired_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_link_addresses_link").on(t.linkId),
    index("idx_link_addresses_org").on(t.orgId),
  ],
);

export const clicks = sqliteTable(
  "clicks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    ts: integer("ts").notNull(),
    country: text("country").notNull().default(""),
    referrer: text("referrer").notNull().default(""),
    device: text("device").notNull().default(""),
    // Set by the click queue producer (crypto.randomUUID()); lets the queue
    // consumer's batch insert dedupe a redelivered message. Null on rows from
    // before this column existed, and on rows the daily sweep has cleared
    // once no redelivery can reach them (sweepDedupeIds, #70). Either way
    // SQLite's unique index treats every NULL as distinct, so those rows
    // never collide with each other or with real dedupe ids.
    dedupeId: text("dedupe_id").unique(),
    // Which address the click came in on (primary or an alias). Null on rows
    // from before this column existed: not backfilled, same reasoning as
    // dedupeId above. Link-level aggregates roll up by linkId regardless.
    addressId: text("address_id").references(() => linkAddresses.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_clicks_link_ts").on(t.linkId, t.ts),
    index("idx_clicks_org_ts").on(t.orgId, t.ts),
    index("idx_clicks_address_ts").on(t.addressId, t.ts),
  ],
);

// No storage outbox or failure table: KV/R2 follow-up work rides Cloudflare
// Queues, and the queue's own dead-letter queue holds give-ups (four days) for
// an operator to re-drive.

/**
 * Links made on the landing page by someone with no account (Direction A of
 * #96). Deliberately unrelated to `orgs`, `user` and `links`: at the moment a
 * row is written, none of those exist for this visitor.
 *
 * Claiming one at signup moves it into `links` properly and deletes the row,
 * so nothing downstream ever sees a half-owned link. Anything unclaimed
 * expires in 24 hours and the daily sweep removes it.
 */
export const anonLinks = sqliteTable(
  "anon_links",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    destination: text("destination").notNull(),
    /** Bearer proof of "I am the browser that made this". Single-use. */
    claimToken: text("claim_token").notNull().unique(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    riskScore: integer("risk_score"),
    riskReasons: text("risk_reasons"),
    riskCheckedAt: integer("risk_checked_at"),
    riskProvider: text("risk_provider"),
  },
  (t) => [index("idx_anon_links_expires").on(t.expiresAt)],
);

/**
 * Storage work D1 committed and the queue did not (#118).
 *
 * The queue is the fast path and stays that way. A row lands here only when
 * `sendBatch` failed outright, or when a message exhausted every delivery, so
 * a change that would otherwise be lost is instead applied late by the daily
 * drain.
 *
 * It carries no payload beyond the op and its target. Every storage message
 * is desired-state: the consumer reads D1 and writes what it finds, so
 * re-deriving the value when the drain runs is both simpler and more correct
 * than replaying one captured at the time of the failure.
 */
export const storageOutbox = sqliteTable(
  "storage_outbox",
  {
    id: text("id").primaryKey(),
    op: text("op", { enum: ["kv_sync", "r2_delete", "r2_delete_prefix"] }).notNull(),
    target: text("target").notNull(),
    reason: text("reason", { enum: ["send_failed", "gave_up"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error").notNull().default(""),
  },
  // The drain's ordering index is an expression over created_at and attempts,
  // which drizzle cannot express; it lives in migration 0024.
  (t) => [uniqueIndex("idx_storage_outbox_target").on(t.op, t.target)],
);
