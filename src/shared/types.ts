import { oneOf } from "./lookup";

/** Carries a solved Cap token (#98) on the requests that need one. A header,
 * not a body field, because better-auth validates each endpoint's body
 * against its own schema. */
export const CAP_TOKEN_HEADER = "x-cap-token";

/** What the Worker answers when a Cap token is missing, expired, or already
 * spent. The browser retries once with a fresh one rather than showing it. */
export const CAP_FAILED_CODE = "CAP_FAILED";

/** Anything that survives a round trip through JSON: what a request or
 * response body is, before anyone has checked it means what it should. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** The roles an invite may hand out: never owner, which only a transfer moves. */
export const INVITABLE_ROLES = ["member", "admin"] as const;

export const ORG_PLANS = ["free", "hobby", "pro"] as const;

/** The plans an admin may comp: the paid ones, since comping free is nothing. */
export const COMP_PLANS = ["hobby", "pro"] as const;
export type OrgPlan = (typeof ORG_PLANS)[number];

/**
 * The plan on a row, which reaches here as a text column or a JSON field.
 *
 * Anything unrecognised is free. A plan nobody sells must never grant more
 * than the free one does, and that decision belongs here rather than at each
 * of the places that read one.
 */
export function orgPlanOf(value: string | null | undefined): OrgPlan {
  return oneOf(ORG_PLANS, value ?? "", "free");
}

export interface PlanLimits {
  orgs: number; // orgs a user may own on this plan
  links: number;
  members: number; // total members incl. owner
  domains: number;
  /** Whether the plan may style a QR: logo, colors, dot and corner shapes,
   * and the org-wide defaults. Generating a plain QR and downloading it is
   * free on every plan, so this gates the look, never the code itself. */
  qrCustom: boolean;
  analyticsDays: number; // how far back click analytics look
}

export const PLAN_LIMITS = {
  free: {
    orgs: 1,
    links: 30,
    members: 3 /* owner + 2 */,
    domains: 0,
    qrCustom: false,
    analyticsDays: 7,
  },
  hobby: {
    orgs: 1,
    links: 500,
    members: 5,
    domains: 1,
    qrCustom: true,
    analyticsDays: 30,
  },
  pro: {
    orgs: 3,
    links: 3000,
    members: 25,
    domains: 5,
    qrCustom: true,
    analyticsDays: 365,
  },
} satisfies Record<OrgPlan, PlanLimits>;

/** Display prices for the paid plans; the charge itself is set in Polar. */
export const PLAN_PRICES = {
  hobby: "$4",
  pro: "$9",
} satisfies Record<Exclude<OrgPlan, "free">, string>;

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
  /**
   * Whether a Polar customer exists for this user, which is what the
   * subscription portal needs. A paid plan does not imply one: an admin can
   * comp a plan, and a webhook can carry a null customer id. Without this the
   * billing page cannot tell a subscriber from a comped user, and offers both
   * a portal only one of them has (#85). Never the customer id itself: the
   * client has no use for a provider identifier.
   */
  hasBillingAccount: boolean;
  /**
   * Whether this plan was granted by an admin rather than bought (#81).
   *
   * Separate from `hasBillingAccount`, because the two answer different
   * questions and can disagree: a comped user has no portal, and so does a
   * subscriber whose webhook carried no customer id. Telling the second group
   * their plan "was granted directly" would be a plain lie, so the page needs
   * to know which one it is talking to.
   */
  comped: boolean;
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
  /**
   * Which domain new links start on (#69), or null for the shared one.
   *
   * A preference, not a permission: the id can point at a domain that has
   * since stopped serving, so a reader resolves it against the org's active
   * domains rather than trusting it (`resolveDefaultDomainId`).
   */
  defaultDomainId: string | null;
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
  /** Why the domain is in `error`, ready to show. Empty for every other status. */
  statusReason: string;
  rootRedirect: string;
  createdAt: number;
}

/** Public deployment config the SPA needs (no secrets). */
export interface AppConfig {
  /** Shared redirect host; the CNAME target for custom domains. */
  appHost: string;
}

/** A link/address mutation's response, plus the org's fresh link-quota usage
 * (see #100): the write that changed it already knows the new count, so the
 * client can skip the follow-up GET /links/quota-usage. */
export type WithQuotaUsage<T> = T & { quotaUsage: number };

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
  /** Count of active addresses (primary + aliases) this link answers to. See #38. */
  addressCount: number;
  /** User id of the creator, null when that account is gone. */
  createdBy: string | null;
}

/** One address (primary or alias) a link answers to. See #38. */
export interface AddressDTO {
  id: string;
  domainId: string | null;
  /** hostname of the custom domain, null = shared default domain */
  domain: string | null;
  slug: string;
  kind: "primary" | "temp_alias" | "permanent_alias";
  creationReason: "created" | "renamed" | "promoted" | "same_destination_merge" | "";
  /** Epoch ms; null = never expires. Set only on a temp_alias. */
  expiresAt: number | null;
  /** Epoch ms once removed or swept; null while still active. */
  retiredAt: number | null;
  createdAt: number;
  /** Clicks in the last 7 days; only meaningful for a non-primary address. */
  recentClicks: number;
  lastUse: number | null;
  referrers: TopEntry[];
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
  /** Create only: skip the same-destination match and always start a new link. */
  forceSeparateLink?: boolean;
  /** Create only: add this address to an existing link (from a same-destination
   * match) instead of creating a new one. */
  mergeIntoLinkId?: string;
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
  id: string;
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
  /** Business row.
   *
   * Counts, never money (#82). `planCounts` describes feature access and
   * includes comped users; `payingSubscribers` counts real Polar
   * subscriptions and excludes them; `compedUsers` is the difference. Revenue
   * is read in the Polar dashboard, which knows what it charged net of
   * discounts, tax and refunds. */
  planCounts: { free: number; hobby: number; pro: number };
  payingSubscribers: number;
  compedUsers: number;
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
  ownerName: string | null;
  ownerEmail: string | null;
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

/** One link in the cross-org admin list (#67). Never returned to an org. */
export interface AdminLinkRow {
  id: string;
  slug: string;
  domain: string | null;
  destination: string;
  orgId: string;
  orgName: string;
  createdBy: string | null;
  createdAt: number;
  clicks: number;
  suspendedAt: number | null;
  suspendReason: string | null;
  /** Destination scoring (#68). Null means unscored, never clean. */
  riskScore: number | null;
  riskReasons: string[];
  riskCheckedAt: number | null;
}

/** An anonymous link made on the landing page (Direction A of #96). It has no
 * org and no owner, so it cannot share AdminLinkRow's shape. */
export interface AdminAnonLinkRow {
  id: string;
  slug: string;
  destination: string;
  createdAt: number;
  expiresAt: number;
  riskScore: number | null;
  riskReasons: string[];
}

export interface AdminActionRow {
  id: string;
  actorUserId: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  createdAt: number;
}

/** How the admin link list may be ordered. `risk` puts the worst first, which
 * is the whole reason #68 fills those columns. */
export const ADMIN_LINK_SORTS = ["created", "clicks", "risk"] as const;
export type AdminLinkSort = (typeof ADMIN_LINK_SORTS)[number];

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  banned: boolean;
  emailVerified: boolean;
  /** Email domain is a known throwaway provider. Display-only, computed on read. */
  disposable: boolean;
  /** Effective plan: what this user may do. A comp counts here (#81). */
  plan: OrgPlan;
  /** What Polar says, separately from what the user may do. `null` means no
   * subscription; the status is Polar's own string (`active`, `past_due`, …). */
  subscriptionPlan: Exclude<OrgPlan, "free"> | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  /** What an admin granted by hand, and who granted it. */
  compPlan: Exclude<OrgPlan, "free"> | null;
  compReason: string | null;
  compGrantedAt: number | null;
  compGrantedBy: string | null;
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
