export type OrgRole = "owner" | "admin" | "member";
export type OrgPlan = "free" | "hobby" | "pro";

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
  hobby: {
    orgs: 1,
    links: 500,
    members: 5,
    domains: 1,
    qr: true,
    analyticsDays: 30,
  },
  pro: {
    orgs: 3,
    links: 3000,
    members: 25,
    domains: 5,
    qr: true,
    analyticsDays: 365,
  },
};

/** Display prices for the paid plans; the charge itself is set in Polar. */
export const PLAN_PRICES: Record<Exclude<OrgPlan, "free">, string> = {
  hobby: "$4",
  pro: "$9",
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
/** Corner ('eye') shapes; "" means inherit/default (QR_DEFAULT_CORNER). */
export const QR_CORNER_STYLES = ["extra-rounded", "rounded", "dot", "square", "classy"] as const;
/** Built-in defaults when neither link nor org overrides them. */
export const QR_DEFAULT_COLOR = "#17151f";
export const QR_DEFAULT_CORNER = "extra-rounded";
export const QR_DEFAULT_BG = "#ffffff";
/** Logo footprint (qr-code-styling imageSize ratio) when the org doesn't set one. */
export const QR_DEFAULT_LOGO_SIZE = 0.35;
/** QR logos are converted to a square WebP before storage in R2. */
export const QR_LOGO_MAX_BYTES = 256 * 1024;
export const QR_LOGO_MAX_DIMENSION = 512;

export interface User {
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

export interface QrOverrides {
  qrLogo: string;
  qrStyle: string;
  qrColor: string;
  qrCorner: string;
  qrBg: string;
  qrEyeColor: string;
  qrLogoSize: number | null;
}

export interface UserOrg extends QrOverrides {
  id: string;
  name: string;
  role: OrgRole;
  // Effective plan for this org = its owner's plan (not the caller's).
  plan: OrgPlan;
}

export interface CurrentUser {
  user: User;
  orgs: UserOrg[];
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

export interface LinkDTO extends QrOverrides {
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
  createdAt: number;
  clicks: number;
  /** User id of the creator, null when that account is gone. */
  createdBy: string | null;
}

export type LinkInput = {
  domainId?: string | null;
  slug?: string;
  destination: string;
  title?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
} & Partial<QrOverrides>;

export interface SeriesPoint {
  day: string;
  clicks: number;
}

export interface TopEntry {
  key: string;
  clicks: number;
}

export interface DeltaValue {
  current: number;
  previous: number;
  /** Percentage change relative to the previous period, null when previous is 0. */
  pct: number | null;
}

export interface OrgStats {
  totalClicks: number;
  totalLinks: number;
  clicks7d: number;
  rangeDays: number; // analytics window for this org's plan
  /** Whether the returned series is bucketed by day or by hour. */
  bucket: "day" | "hour";
  series: SeriesPoint[];
  /** 24 hour buckets for the last 24 hours, populated when bucket is "hour". */
  hourSeries: SeriesPoint[];
  totalClicksDelta: DeltaValue | null;
  clicks7dDelta: DeltaValue | null;
  topLinks: { id: string; slug: string; title: string; clicks: number }[];
  countries: TopEntry[];
  referrers: TopEntry[];
  devices: TopEntry[];
  /** Links with zero clicks in the last 30 days. */
  deadLinks: { id: string; slug: string; title: string }[];
  /** Links whose last-7d clicks dropped more than 50% vs the prior 7d. */
  decayingLinks: { id: string; slug: string; title: string; drop: number }[];
  /** Day-of-week × hour-of-day heatmap over the window. */
  heatmap: HeatmapRow[];
  /** Clicks grouped by utm_campaign (non-empty only). */
  campaigns: { campaign: string; clicks: number }[];
  /** Clicks grouped by utm_source (non-empty only). */
  sources: { source: string; clicks: number }[];
  /** Clicks grouped by utm_medium (non-empty only). */
  mediums: { medium: string; clicks: number }[];
}

export interface HeatmapRow {
  /** 0=Monday … 6=Sunday */
  dayOfWeek: number;
  hour: number;
  clicks: number;
}

/** One row of the org's recent-clicks feed on the dashboard. */
export interface RecentClick {
  id: number;
  ts: number;
  country: string;
  /** Referrer host, "" for direct/unknown traffic. */
  referrer: string;
  device: string;
  slug: string;
  domain: string | null;
}

export interface LinkStats {
  totalClicks: number;
  clicks7d: number;
  rangeDays: number;
  series: SeriesPoint[];
  totalClicksDelta: DeltaValue | null;
  clicks7dDelta: DeltaValue | null;
  countries: TopEntry[];
  referrers: TopEntry[];
  devices: TopEntry[];
  slug: string;
  domain: string | null;
  destination: string;
  title: string;
  createdAt: number;
  lastClick: number | null;
  createdBy: string | null;
}

export interface AdminUsage {
  users: number;
  orgs: number;
  links: number;
  clicks: number;
  clicks7d: number;
  proUsers: number;
  series: SeriesPoint[];
  /** New accounts per day, same window as `series`. */
  signups: SeriesPoint[];
  /** Most-clicked orgs/links over the same window as `series`. */
  topOrgs: { id: string; name: string; clicks: number; plan: OrgPlan }[];
  topLinks: {
    id: string;
    slug: string;
    domain: string | null;
    orgName: string;
    clicks: number;
  }[];
  /** Business row */
  planCounts: { free: number; hobby: number; pro: number };
  mrr: number;
  paidConversionRate: number | null;
  signups7d: number;
  signups7dDelta: DeltaValue | null;
  wau: number;
  /** Growth row */
  cumulativeUsers: SeriesPoint[];
  cumulativeOrgs: SeriesPoint[];
  /** Health row */
  botSeries: SeriesPoint[];
  anomalies: AnomalyEntry[];
  capPressure: CapPressureEntry[];
  tableSize: number;
  tableGrowth: SeriesPoint[];
  tableProjectedDays: number | null;
}

export interface AnomalyEntry {
  orgId: string;
  orgName: string;
  clicks24h: number;
  avg14d: number;
  ratio: number;
}

export interface CapPressureEntry {
  orgId: string;
  orgName: string;
  plan: OrgPlan;
  linksPct: number;
  membersPct: number;
  domainsPct: number;
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
  banned: boolean;
  emailVerified: boolean;
  plan: OrgPlan;
  createdAt: number;
  orgCount: number;
  /** Last session activity (ms epoch), null if never signed in. */
  lastSeen: number | null;
}

export interface InvitePreview {
  orgName: string;
  role: OrgRole;
}

export type Sort = { key: string; dir: 1 | -1 };
