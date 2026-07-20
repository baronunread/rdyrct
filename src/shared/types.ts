export type OrgRole = "owner" | "admin" | "member";
export type OrgPlan = "free" | "pro";

export interface PlanLimits {
  orgs: number; // orgs a user may own on this plan
  links: number;
  members: number; // total members incl. owner
  domains: number;
  qr: boolean;
  analyticsDays: number; // how far back click analytics look
}

export const PLAN_LIMITS: Record<OrgPlan, PlanLimits> = {
  free: {
    orgs: 1,
    links: 30,
    members: 3 /* owner + 2 */,
    domains: 0,
    qr: false,
    analyticsDays: 7,
  },
  pro: {
    orgs: 3,
    links: 3000,
    members: 25,
    domains: 3,
    qr: true,
    analyticsDays: 90,
  },
};

/** QR dot styles supported by qr-code-styling; "" means inherit/default. */
export const QR_DOT_STYLES = [
  "rounded",
  "square",
  "dots",
  "classy",
  "classy-rounded",
  "extra-rounded",
] as const;
export type QrDotStyle = (typeof QR_DOT_STYLES)[number];
/** Built-in QR ink color when neither link nor org overrides it. */
export const QR_DEFAULT_COLOR = "#17151f";

export interface MeUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  emailVerified: boolean;
  // The user's own subscription: drives the billing tab + multi-org limit.
  plan: OrgPlan;
  polarSubscriptionCancelAtPeriodEnd: boolean;
  polarSubscriptionCurrentPeriodEnd: number | null;
}

export interface MeOrg {
  id: string;
  name: string;
  role: OrgRole;
  // Effective plan for this org = its owner's plan (not the caller's).
  plan: OrgPlan;
  // Org-level QR defaults; "" = built-in default.
  qrLogo: string;
  qrStyle: string;
  qrColor: string;
}

export interface Me {
  user: MeUser;
  orgs: MeOrg[];
}

export interface MemberDTO {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  createdAt: number;
}

export interface InviteDTO {
  token: string;
  role: OrgRole;
  /** Address the magic link was emailed to, or null for a copy-only link. */
  email: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface DomainDTO {
  id: string;
  hostname: string;
  status: "checking_dns" | "issuing_tls" | "active" | "error";
  rootRedirect: string;
  createdAt: number;
}

/** Public deployment config the SPA needs (no secrets). */
export interface AppConfig {
  /** Shared redirect host; the CNAME target for custom domains. */
  appHost: string;
}

export interface LinkDTO {
  id: string;
  domainId: string | null;
  /** hostname of the custom domain, null = shared default domain */
  domain: string | null;
  slug: string;
  destination: string;
  title: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
  qrLogo: string;
  /** Per-link QR overrides; "" = inherit the org's defaults. */
  qrStyle: string;
  qrColor: string;
  createdAt: number;
  clicks: number;
}

export interface LinkInput {
  domainId?: string | null;
  slug?: string;
  destination: string;
  title?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  qrLogo?: string;
  qrStyle?: string;
  qrColor?: string;
}

export interface SeriesPoint {
  day: string;
  clicks: number;
}

export interface TopEntry {
  key: string;
  clicks: number;
}

export interface OrgStats {
  totalClicks: number;
  totalLinks: number;
  clicks7d: number;
  rangeDays: number; // analytics window for this org's plan
  series: SeriesPoint[];
  topLinks: { id: string; slug: string; title: string; clicks: number }[];
  countries: TopEntry[];
  referrers: TopEntry[];
  devices: TopEntry[];
}

export interface AdminOverview {
  users: number;
  orgs: number;
  links: number;
  clicks: number;
  clicks7d: number;
  series: SeriesPoint[];
}

export interface AdminOrgRow {
  id: string;
  name: string;
  plan: OrgPlan;
  createdAt: number;
  members: number;
  links: number;
  clicks: number;
}

export interface AdminOrgDetail {
  id: string;
  name: string;
  plan: OrgPlan;
  createdAt: number;
  members: MemberDTO[];
  links: {
    id: string;
    slug: string;
    domain: string | null;
    destination: string;
    clicks: number;
    createdAt: number;
  }[];
  series: SeriesPoint[];
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  plan: OrgPlan;
  createdAt: number;
  orgCount: number;
}

export interface InvitePreview {
  orgName: string;
  role: OrgRole;
}
