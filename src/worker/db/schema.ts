// fallow-ignore-file code-duplication -- BetterAuth's OAuth token tables share columns by design
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { REPORT_REASONS, type AudienceFilter } from "../../shared/types";
import type { NewsletterDoc } from "../newsletter-doc";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  lastSeenAt: integer("last_seen_at"),
  // DERIVED: coalesce(comp_plan, entitling subscription_plan, free). Only entitlement.ts
  // writes it, from the two columns below in one statement (#81).
  plan: text("plan", { enum: ["free", "hobby", "pro"] })
    .notNull()
    .default("free"),
  auditedPlan: text("audited_plan", { enum: ["free", "hobby", "pro"] })
    .notNull()
    .default("free"),
  // Written by the Polar webhook only. subscriptionStatus is kept raw so a status
  // with no rule is still visible.
  subscriptionPlan: text("subscription_plan", { enum: ["hobby", "pro"] }),
  subscriptionStatus: text("subscription_status"),
  // No price on purpose (#82): Polar knows what it charged, net of discounts, tax and refunds.
  // A comp outranks the subscription, so revoking a subscription cannot remove access an admin gave.
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
  polarSubscriptionInterval: text("polar_subscription_interval", { enum: ["month", "year"] }),
  polarSubscriptionCurrentPeriodEnd: integer("polar_subscription_current_period_end", {
    mode: "timestamp_ms",
  }),
  // Every webhook mutation refuses to write over a newer value, so a late or replayed
  // delivery is harmless.
  polarEventAt: integer("polar_event_at", { mode: "timestamp_ms" }),
  welcomeSentAt: integer("welcome_sent_at", { mode: "timestamp_ms" }),
  newsOptInAt: integer("news_opt_in_at", { mode: "timestamp_ms" }),
  newsOptInSource: text("news_opt_in_source", { enum: ["onboarding", "prompt", "settings"] }),
  offersOptInAt: integer("offers_opt_in_at", { mode: "timestamp_ms" }),
  offersOptInSource: text("offers_opt_in_source", { enum: ["onboarding", "prompt", "settings"] }),
  marketingAskedAt: integer("marketing_asked_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const limitOverrides = sqliteTable(
  "limit_overrides",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    limitKey: text("limit_key", {
      enum: [
        "orgs",
        "links",
        "members",
        "domains",
        "qr_custom",
        "analytics_days",
        "tracked_clicks",
      ],
    }).notNull(),
    value: integer("value").notNull(),
    note: text("note"),
    setBy: text("set_by"),
    setAt: integer("set_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.limitKey] })],
);

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
    email: text("email"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("idx_account_user").on(t.userId),
    uniqueIndex("idx_account_provider_account_id").on(t.providerId, t.accountId),
  ],
);

// Lets BetterAuth read a session and its user in one query (advanced.database.joins).
export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));
export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));
export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

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
  ...qrColumns(),
  // No foreign key declared here: domains references this table already. The ON DELETE
  // SET NULL is in migration 0018.
  defaultDomainId: text("default_domain_id"),
  createdAt: integer("created_at").notNull(),
  // Set before teardown starts, so requireOrgRole rejects writes before the workflow gathers.
  deletingAt: integer("deleting_at"),
  // Beyond the owner orgs cap (#160). Read-only, but its links keep redirecting.
  lockedAt: integer("locked_at"),
  // Set with a whole-org link suspension, so the org cannot mint a replacement link.
  // Unlike lockedAt, its links stop redirecting.
  linksSuspendedAt: integer("links_suspended_at"),
  reviewFlaggedAt: integer("review_flagged_at"),
  // Set when an admin reviews: the automatic suspend and flag stand down, or the next
  // sweep undoes the decision.
  clearedAt: integer("cleared_at"),
  // Set when the abuse sweep warns the org links. A link made while it is set is born warned.
  linksWarnedAt: integer("links_warned_at"),
  linksWarnReason: text("links_warn_reason"),
  webRiskDay: integer("web_risk_day"),
  webRiskLookups: integer("web_risk_lookups"),
  disabledAt: integer("disabled_at"),
});

// Nothing here decides access: the marker columns do (orgs.lockedAt, domains.lockedAt,
// orgMembers.previousRole).
export const orgEntitlements = sqliteTable(
  "org_entitlements",
  {
    orgId: text("org_id")
      .primaryKey()
      .references(() => orgs.id, { onDelete: "cascade" }),
    plan: text("plan", { enum: ["free", "hobby", "pro"] }).notNull(),
    overJson: text("over_json").notNull().default("{}"),
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
    // Set when the invite was emailed to an address: only that account may accept.
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
    statusReason: text("status_reason").notNull().default(""),
    rootRedirect: text("root_redirect").notNull().default(""),
    cfHostnameId: text("cf_hostname_id"),
    // http waits for the CNAME. txt checks TXT records, so a domain still on another
    // service is ready before its CNAME switches (#383).
    validation: text("validation", { enum: ["http", "txt"] })
      .notNull()
      .default("http"),
    // Beyond the domains cap after a downgrade (#159). Serves until grace ends; the row, KV
    // entry and hostname stay, so an upgrade restores it.
    lockedAt: integer("locked_at"),
    checkingSince: integer("checking_since"),
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
    // Slug uniqueness is the raw index idx_links_domain_slug on (ifnull(domain_id,''), slug),
    // created in migrations: drizzle cannot express ifnull indexes.
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
    // Null means unscored, never clean: a provider outage and a clean answer must not
    // look the same (#68). Admin-only (#67).
    riskScore: integer("risk_score"),
    riskReasons: text("risk_reasons"),
    riskCheckedAt: integer("risk_checked_at"),
    riskProvider: text("risk_provider"),
    // The redirect stops because desiredKvValue publishes a suspended link key as held (#344).
    // Put the check anywhere else and the next edit un-suspends it in silence.
    suspendedAt: integer("suspended_at"),
    suspendedBy: text("suspended_by").references(() => user.id, { onDelete: "set null" }),
    suspendReason: text("suspend_reason"),
    warnedAt: integer("warned_at"),
    warnReason: text("warn_reason"),
    webRiskCheckedAt: integer("web_risk_checked_at"),
  },
  (t) => [index("idx_links_org").on(t.orgId), index("idx_links_created_by").on(t.createdBy)],
);

// No foreign keys: the record must outlive a deleted admin and its target (#67).
export const adminActions = sqliteTable(
  "admin_actions",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detail: text("detail"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_admin_actions_created").on(t.createdAt),
    index("idx_admin_actions_target").on(t.targetType, t.targetId),
  ],
);

// Slug uniqueness lives on the active subset (idx_link_addresses_domain_slug_active, a
// partial index in migrations), so a retired alias cannot collide with the new primary.
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
    expiresAt: integer("expires_at"),
    retiredAt: integer("retired_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_link_addresses_link").on(t.linkId),
    index("idx_link_addresses_org").on(t.orgId),
  ],
);

// Link and org are null when the address matched nothing: stored anyway so the form
// answers the same for every slug.
export const linkReports = sqliteTable("link_reports", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  linkId: text("link_id").references(() => links.id, { onDelete: "set null" }),
  orgId: text("org_id").references(() => orgs.id, { onDelete: "set null" }),
  reason: text("reason", { enum: REPORT_REASONS }).notNull(),
  note: text("note").notNull().default(""),
  contact: text("contact").notNull().default(""),
  status: text("status").notNull().default("open"),
  createdAt: integer("created_at").notNull(),
  // An HMAC of the connection and the link id, never the address.
  reporterKey: text("reporter_key"),
  notifiedAt: integer("notified_at"),
  // No foreign key: the anonymous row is deleted after 24 hours (#488).
  anonLinkId: text("anon_link_id"),
});

export const blockedHosts = sqliteTable("blocked_hosts", {
  host: text("host").primaryKey(),
  reason: text("reason").notNull().default(""),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: integer("created_at").notNull(),
});

export const linkImports = sqliteTable(
  "link_imports",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    service: text("service").notNull(),
    status: text("status", { enum: ["uploading", "running", "done", "dismissed"] })
      .notNull()
      .default("uploading"),
    total: integer("total").notNull(),
    createdAt: integer("created_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [index("idx_link_imports_org").on(t.orgId, t.createdAt)],
);

export const linkImportRows = sqliteTable(
  "link_import_rows",
  {
    importId: text("import_id")
      .notNull()
      .references(() => linkImports.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    host: text("host").notNull(),
    slug: text("slug").notNull(),
    destination: text("destination").notNull(),
    title: text("title").notNull().default(""),
    status: text("status", { enum: ["pending", "imported", "exists", "failed"] })
      .notNull()
      .default("pending"),
    reason: text("reason").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.importId, t.line] }),
    index("idx_link_import_rows_status").on(t.importId, t.status),
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
    // Lets the queue consumer dedupe a redelivered message (#70). Migration 0027 owns the
    // partial unique index; it excludes NULL, so swept rows carry no index weight.
    dedupeId: text("dedupe_id"),
    addressId: text("address_id").references(() => linkAddresses.id, { onDelete: "set null" }),
  },
  (t) => [
    index("idx_clicks_link_ts").on(t.linkId, t.ts),
    index("idx_clicks_org_ts").on(t.orgId, t.ts),
    index("idx_clicks_address_ts").on(t.addressId, t.ts),
  ],
);

// Migration 0042 owns these tables (Drizzle cannot express WITHOUT ROWID). Only
// insertClicks writes them (#26).
export const clickDaily = sqliteTable(
  "click_daily",
  {
    orgId: text("org_id").notNull(),
    day: text("day").notNull(),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    clicks: integer("clicks").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.day, t.linkId] }),
    index("idx_click_daily_link").on(t.linkId, t.day, t.clicks),
  ],
);

export const CLICK_DIMENSIONS = ["country", "referrer", "device"] as const;

export const clickDailyDims = sqliteTable(
  "click_daily_dims",
  {
    orgId: text("org_id").notNull(),
    dim: text("dim", { enum: CLICK_DIMENSIONS }).notNull(),
    day: text("day").notNull(),
    value: text("value").notNull(),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    clicks: integer("clicks").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.dim, t.day, t.value, t.linkId] }),
    index("idx_click_daily_dims_link").on(t.linkId, t.dim, t.day, t.value, t.clicks),
  ],
);

export const clickHourly = sqliteTable(
  "click_hourly",
  {
    orgId: text("org_id").notNull(),
    hour: integer("hour").notNull(),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    clicks: integer("clicks").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.hour, t.linkId] }),
    index("idx_click_hourly_link").on(t.linkId, t.hour, t.clicks),
  ],
);

// The exact count the plan cap is checked against (#387). insertClicks adds only clicks it stored.
export const orgClickUsage = sqliteTable(
  "org_click_usage",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    clicks: integer("clicks").notNull(),
    // A cap rather than a timestamp, so a mid-month plan change earns the new cap its own email.
    warnedLimit: integer("warned_limit"),
    cappedLimit: integer("capped_limit"),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.month] }),
    index("idx_org_click_usage_month").on(t.month, t.clicks),
  ],
);

// Only the abuse sweep reads it, so its ceilings still see traffic once it stops being stored.
export const clickOverflow = sqliteTable(
  "click_overflow",
  {
    minute: integer("minute").notNull(),
    orgId: text("org_id").notNull(),
    linkId: text("link_id").notNull(),
    clicks: integer("clicks").notNull(),
  },
  (t) => [primaryKey({ columns: [t.minute, t.orgId, t.linkId] })],
);

export const webRiskUsage = sqliteTable("web_risk_usage", {
  day: integer("day").primaryKey(),
  lookups: integer("lookups").notNull(),
});

export const issuedSlugs = sqliteTable("issued_slugs", {
  slug: text("slug").primaryKey(),
  issuedAt: integer("issued_at").notNull(),
});

// Deliberately unrelated to orgs, user and links: none exist for this visitor when the
// row is written (#96).
export const anonLinks = sqliteTable(
  "anon_links",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    destination: text("destination").notNull(),
    claimToken: text("claim_token").notNull().unique(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    riskScore: integer("risk_score"),
    riskReasons: text("risk_reasons"),
    riskCheckedAt: integer("risk_checked_at"),
    riskProvider: text("risk_provider"),
    // A total only: no country, referrer or device.
    clicks: integer("clicks").notNull().default(0),
  },
  (t) => [index("idx_anon_links_expires").on(t.expiresAt)],
);

// A row lands here only when sendBatch failed outright or a message exhausted every
// delivery; the daily drain applies it. Messages are desired-state, so the drain
// re-derives the value from D1 (#118).
export const storageOutbox = sqliteTable(
  "storage_outbox",
  {
    id: text("id").primaryKey(),
    op: text("op", { enum: ["kv_sync", "r2_delete", "r2_delete_prefix", "org_sync"] }).notNull(),
    target: text("target").notNull(),
    reason: text("reason", { enum: ["send_failed", "gave_up", "pending"] }).notNull(),
    createdAt: integer("created_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error").notNull().default(""),
  },
  // The drain ordering index is an expression over created_at and attempts, in migration 0026.
  (t) => [uniqueIndex("idx_storage_outbox_target").on(t.op, t.target)],
);

// Bound to a user like a session: requireOrgRole still decides what the key may do.
// Only the hash is stored (#131).
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
  },
  (t) => [index("idx_api_keys_user").on(t.userId)],
);

// Shapes follow @better-auth/mcp own schema (from getSchema()). id is better-auth
// generated primary key.

export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  alg: text("alg"),
  crv: text("crv"),
});

// sweepAbandonedOAuthClients() deletes DCR rows (clientDiscoveryId, userId and referenceId null) that never got a grant.
export const oauthClient = sqliteTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
    skipConsent: integer("skip_consent", { mode: "boolean" }),
    enableEndSession: integer("enable_end_session", { mode: "boolean" }),
    subjectType: text("subject_type"),
    scopes: text("scopes", { mode: "json" }).$type<string[]>(),
    clientCredentialsScopes: text("client_credentials_scopes", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    userId: text("user_id").references(() => user.id),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts", { mode: "json" }).$type<string[]>(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris", { mode: "json" }).$type<string[]>().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris", { mode: "json" }).$type<string[]>(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: integer("backchannel_logout_session_required", {
      mode: "boolean",
    }),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types", { mode: "json" }).$type<string[]>(),
    responseTypes: text("response_types", { mode: "json" }).$type<string[]>(),
    requirePKCE: integer("require_pkce", { mode: "boolean" }),
    dpopBoundAccessTokens: integer("dpop_bound_access_tokens", { mode: "boolean" })
      .notNull()
      .default(false),
    referenceId: text("reference_id"),
    metadata: text("metadata", { mode: "json" }),
  },
  (t) => [index("idx_oauth_client_user").on(t.userId)],
);

export const oauthResource = sqliteTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes", { mode: "json" }).$type<string[]>(),
  customClaims: text("custom_claims", { mode: "json" }),
  dpopBoundAccessTokensRequired: integer("dpop_bound_access_tokens_required", { mode: "boolean" })
    .notNull()
    .default(false),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  policyVersion: integer("policy_version").notNull().default(1),
  metadata: text("metadata", { mode: "json" }),
});

export const oauthClientResource = sqliteTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("idx_oauth_client_resource_client").on(t.clientId),
    index("idx_oauth_client_resource_resource").on(t.resourceId),
    uniqueIndex("idx_oauth_client_resource_pair").on(t.clientId, t.resourceId),
  ],
);

// revoked/rotatedAt are set, not deleted, so reuse of a rotated token is recognised.
export const oauthRefreshToken = sqliteTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources", { mode: "json" }).$type<string[]>(),
    requestedUserInfoClaims: text("requested_user_info_claims", { mode: "json" }).$type<string[]>(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    rotatedAt: integer("rotated_at", { mode: "timestamp_ms" }),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: integer("rotation_replay_expires_at", { mode: "timestamp_ms" }),
    authTime: integer("auth_time", { mode: "timestamp_ms" }),
    confirmation: text("confirmation", { mode: "json" }),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
  },
  (t) => [
    index("idx_oauth_refresh_token_client").on(t.clientId),
    index("idx_oauth_refresh_token_session").on(t.sessionId),
    index("idx_oauth_refresh_token_user").on(t.userId),
    index("idx_oauth_refresh_token_auth_code").on(t.authorizationCodeId),
  ],
);

// The JWT carries no revocation check: this row makes the token revocable.
export const oauthAccessToken = sqliteTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources", { mode: "json" }).$type<string[]>(),
    requestedUserInfoClaims: text("requested_user_info_claims", { mode: "json" }).$type<string[]>(),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    revoked: integer("revoked", { mode: "timestamp_ms" }),
    confirmation: text("confirmation", { mode: "json" }),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
  },
  (t) => [
    index("idx_oauth_access_token_client").on(t.clientId),
    index("idx_oauth_access_token_session").on(t.sessionId),
    index("idx_oauth_access_token_user").on(t.userId),
    index("idx_oauth_access_token_auth_code").on(t.authorizationCodeId),
    index("idx_oauth_access_token_refresh").on(t.refreshId),
  ],
);

// Revoking here cascades to every token the grant produced.
export const oauthConsent = sqliteTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId),
    userId: text("user_id").references(() => user.id),
    referenceId: text("reference_id"),
    resources: text("resources", { mode: "json" }).$type<string[]>(),
    requestedUserInfoClaims: text("requested_user_info_claims", { mode: "json" }).$type<string[]>(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("idx_oauth_consent_client").on(t.clientId),
    index("idx_oauth_consent_user").on(t.userId),
  ],
);

export const oauthClientAssertion = sqliteTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const newsletterSends = sqliteTable(
  "newsletter_sends",
  {
    id: text("id").primaryKey(),
    list: text("list", { enum: ["news", "offers"] }).notNull(),
    audience: text("audience", { mode: "json" }).$type<AudienceFilter>().notNull(),
    subject: text("subject").notNull(),
    doc: text("doc", { mode: "json" }).$type<NewsletterDoc>().notNull(),
    sentBy: text("sent_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }),
    status: text("status", {
      enum: ["scheduled", "sending", "sent", "cancelled", "failed"],
    }).notNull(),
    sent: integer("sent").notNull().default(0),
    cursor: text("cursor").notNull().default(""),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("idx_newsletter_sends_created_at").on(t.createdAt)],
);
