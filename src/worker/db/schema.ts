import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("idx_sessions_user").on(t.userId)],
);

export const orgs = sqliteTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
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
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index("idx_org_members_user").on(t.userId),
  ],
);

export const invites = sqliteTable(
  "invites",
  {
    token: text("token").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    acceptedBy: text("accepted_by").references(() => users.id),
  },
  (t) => [index("idx_invites_org").on(t.orgId)],
);

export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    destination: text("destination").notNull(),
    title: text("title").notNull().default(""),
    utmSource: text("utm_source").notNull().default(""),
    utmMedium: text("utm_medium").notNull().default(""),
    utmCampaign: text("utm_campaign").notNull().default(""),
    utmTerm: text("utm_term").notNull().default(""),
    utmContent: text("utm_content").notNull().default(""),
    qrLogo: text("qr_logo").notNull().default(""),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
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
