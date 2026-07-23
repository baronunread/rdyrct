import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";

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
  plan: text("plan", { enum: ["free", "hobby", "pro"] })
    .notNull()
    .default("free"),
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
  createdAt: integer("created_at").notNull(),
});

export const orgMembers = sqliteTable(
  "org_members",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
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
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    // Set when the invite was emailed to a specific address: only that
    // account may accept. Null for copy-only link invites (bearer links).
    email: text("email"),
    // nullable: keep invites/links around if their author is deleted
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    acceptedBy: text("accepted_by").references(() => user.id, {
      onDelete: "set null",
    }),
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
    rootRedirect: text("root_redirect").notNull().default(""),
    cfHostnameId: text("cf_hostname_id"),
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
  },
  (t) => [index("idx_links_org").on(t.orgId)],
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
  },
  (t) => [
    index("idx_clicks_link_ts").on(t.linkId, t.ts),
    index("idx_clicks_org_ts").on(t.orgId, t.ts),
  ],
);
