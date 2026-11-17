import { oneOf } from "./lookup";

/** A header, not a body field: better-auth validates each endpoint's body against its own schema (#304). */
export const TURNSTILE_TOKEN_HEADER = "x-turnstile-token";

export const REPORT_REASONS = ["phishing", "malware", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** The browser retries once with a fresh token rather than showing this. */
export const TURNSTILE_FAILED_CODE = "TURNSTILE_FAILED";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** `viewer` is what an over-cap member is demoted to on downgrade (#29). */
export const ORG_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** The roles an invite may hand out: never owner, which only a transfer moves. */
export const INVITABLE_ROLES = ["viewer", "member", "admin"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const ORG_PLANS = ["free", "hobby", "pro"] as const;

export const COMP_PLANS = ["hobby", "pro"] as const;
export type StoredPlan = (typeof ORG_PLANS)[number];
/** `unlimited` is resolved at read time when billing is not set up. Never written to a row. */
export type OrgPlan = StoredPlan | "unlimited";

/** Anything unrecognised is free: a plan nobody sells must never grant more than free does. */
export function orgPlanOf(value: string | null | undefined): StoredPlan {
  return oneOf(ORG_PLANS, value ?? "", "free");
}

export interface PlanLimits {
  orgs: number; // orgs a user may own on this plan
  links: number;
  members: number; // total members incl. owner
  domains: number;
  /** Generating and downloading a plain QR is free on every plan; this gates the look, never the code. */
  qrCustom: boolean;
  analyticsDays: number; // how far back click analytics look
  trackedClicks: number;
}

/** Derived, never stored: the `plan` column, Polar and `PLAN_LIMITS` know nothing of it. */
export type AccountTier = OrgPlan | "enterprise";

export type LimitOverrides = Partial<PlanLimits>;

export const PLAN_LIMITS = {
  free: {
    orgs: 1,
    links: 30,
    members: 3 /* owner + 2 */,
    domains: 0,
    qrCustom: false,
    analyticsDays: 7,
    trackedClicks: 5_000,
  },
  hobby: {
    orgs: 1,
    links: 500,
    members: 5,
    domains: 1,
    qrCustom: true,
    analyticsDays: 30,
    trackedClicks: 50_000,
  },
  pro: {
    orgs: 1,
    links: 3000,
    members: 25,
    domains: 5,
    qrCustom: true,
    analyticsDays: 365,
    trackedClicks: 500_000,
  },
  // Self-hosted instance: no billing, so nothing is capped. Large finite
  // numbers rather than Infinity, which JSON turns into null.
  unlimited: {
    orgs: 1_000_000,
    links: 1_000_000_000,
    members: 1_000_000,
    domains: 1_000_000,
    qrCustom: true,
    analyticsDays: 36_500,
    trackedClicks: 1_000_000_000_000,
  },
} satisfies Record<OrgPlan, PlanLimits>;

/** Stopping a custom domain breaks every link on it, QR codes already printed included (#159). */
export const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export const GRACE_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export interface OverLimits {
  links?: number;
  members?: number;
  domains?: number;
}

export interface ClickUsage {
  month: string;
  clicks: number;
  limit: number;
  resetsAt: number;
}

export const OVER_LIMIT_KEYS = ["links", "members", "domains"] as const;

export function isOverLimit(over: OverLimits): boolean {
  return OVER_LIMIT_KEYS.some((key) => over[key] !== undefined);
}

/** Display prices for the paid plans; the charge itself is set in Polar. */
export const PLAN_PRICES = {
  hobby: "$4",
  pro: "$9",
} satisfies Record<Exclude<StoredPlan, "free">, string>;

/** 10% off PLAN_PRICES. The real charge lives on the yearly product in Polar. */
export const PLAN_PRICES_YEARLY = {
  hobby: "$3.60",
  pro: "$8.10",
} satisfies Record<Exclude<StoredPlan, "free">, string>;

export const YEARLY_DISCOUNT_LABEL = "Save 10%";

export const QR_DOT_STYLES = [
  "rounded",
  "square",
  "dots",
  "classy",
  "classy-rounded",
  "extra-rounded",
] as const;
export const QR_CORNER_STYLES = ["extra-rounded", "rounded", "dot", "square", "classy"] as const;
export const QR_DEFAULT_COLOR = "#17151f";
export const QR_DEFAULT_CORNER = "extra-rounded";
export const QR_DEFAULT_BG = "#ffffff";
export const QR_DEFAULT_LOGO_SIZE = 0.35;
export const QR_LOGO_MAX_BYTES = 256 * 1024;
export const QR_LOGO_MAX_DIMENSION = 512;

export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_MAX_DIMENSION = 512;

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  emailVerified: boolean;
  plan: OrgPlan;
  tier: AccountTier;
  limits: PlanLimits;
  polarSubscriptionCancelAtPeriodEnd: boolean;
  polarSubscriptionCurrentPeriodEnd: number | null;
  polarSubscriptionInterval: "month" | "year" | null;
  /** A paid plan does not imply a Polar customer (comp, or a webhook with a null id) (#85). Never the id itself: the client has no use for it. */
  hasBillingAccount: boolean;
  /** Separate from hasBillingAccount: a comped user and a subscriber with no customer id both lack a portal, but only one was granted the plan (#81). */
  comped: boolean;
  image: string | null;
  /** Marketing consent, per list. Never read off the cached user: see marketing.ts. */
  marketing: MarketingState;
  marketingOffered: boolean;
}

export const MARKETING_SOURCES = ["onboarding", "prompt", "settings"] as const;
export type MarketingSource = (typeof MARKETING_SOURCES)[number];

export const MARKETING_LISTS = ["news", "offers"] as const;
export type MarketingList = (typeof MARKETING_LISTS)[number];

export const MARKETING_LIST_LABELS = {
  news: "Product news",
  offers: "Offers",
} satisfies Record<MarketingList, string>;

export interface MarketingState {
  news: boolean;
  offers: boolean;
  asked: boolean;
}

/** A list left out stays as it is, so Settings can change one list; onboarding and the dialog send both. */
export interface MarketingAnswer {
  source: MarketingSource;
  news?: boolean;
  offers?: boolean;
}

export const AUDIENCE_STAGES = ["any", "new", "active", "slipping"] as const;
export type AudienceStage = (typeof AUDIENCE_STAGES)[number];

export const ACTIVE_WITHIN_DAYS = 30;

export const AUDIENCE_PLANS = ["any", "free", "paid"] as const;
export type AudiencePlan = (typeof AUDIENCE_PLANS)[number];

/** Every filter holds at once (AND). A new one needs an "any" default and a clause in marketing.ts's `audienceWhere`. */
export interface AudienceFilter {
  stage: AudienceStage;
  plan: AudiencePlan;
}

export const EVERYONE: AudienceFilter = { stage: "any", plan: "any" };

export interface NewsletterAnswers {
  /** Counts every account, so the total can exceed `optedIn` (unverified or banned accounts get no send). */
  yes: Record<MarketingSource, number>;
  no: number;
  unasked: number;
}

export type NewsletterSendStatus = "scheduled" | "sending" | "sent" | "cancelled" | "failed";

export interface NewsletterSendRow {
  id: string;
  list: MarketingList;
  audience: AudienceFilter;
  subject: string;
  sentBy: string | null;
  createdAt: number;
  scheduledFor: number | null;
  status: NewsletterSendStatus;
  sent: number;
  finishedAt: number | null;
}

/** worker/newsletter-doc.ts parses a document against this allow-list. */
export type DocMark =
  | { type: "bold" | "italic" | "underline" }
  | { type: "link"; attrs: { href: string } };
export type DocInline = { type: "text"; text: string; marks?: DocMark[] } | { type: "hardBreak" };
export type DocListItem = { type: "listItem"; content: DocBlock[] };
export type DocBlock =
  | { type: "paragraph"; content?: DocInline[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: DocInline[] }
  | { type: "horizontalRule" }
  | { type: "button"; attrs: { href: string }; content?: DocInline[] }
  | { type: "bulletList"; content: DocListItem[] }
  | { type: "orderedList"; attrs?: { start?: number | null }; content: DocListItem[] };
export type NewsletterDoc = { type: "doc"; content: DocBlock[] };

export interface NewsletterDraft {
  list: MarketingList;
  audience: AudienceFilter;
  subject: string;
  doc: NewsletterDoc;
}

export interface NewsletterPreview {
  html: string;
}

export interface NewsletterStatus {
  optedIn: Record<MarketingList, number>;
  answers: Record<MarketingList, NewsletterAnswers>;
  sends: NewsletterSendRow[];
  configured: boolean;
}

export type ConsentAnswer = "on" | "off" | "unasked";

export interface NewsletterAudienceCount {
  count: number;
  /** Echoed back so a count still loading never shows under the next filter's wording. */
  list: MarketingList;
  filter: AudienceFilter;
}

export interface NewsletterTestResult {
  sent: number;
}

export interface NewsletterSendState {
  id: string;
  status: NewsletterSendStatus;
  scheduledFor: number | null;
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
  plan: OrgPlan;
  /** A preference, not a permission: the id can point at a domain that stopped serving, so resolve it with `resolveDefaultDomainId`. */
  defaultDomainId: string | null;
  locked: boolean;
  tier: AccountTier;
  limits: PlanLimits;
  over: OverLimits;
  graceEndsAt: number | null;
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
  /** Demoted by a downgrade, not chosen (#161): an upgrade puts the old role back. */
  demoted: boolean;
  lastActiveAt: number | null;
  /** The org's members route always sends it; the admin org view does not. */
  image?: string | null;
}

export interface InviteDTO {
  token: string;
  role: OrgRole;
  email: string | null;
  createdAt: number;
  expiresAt: number;
}

/** `failed` addresses have invites that exist; asking again resends the same ones. */
export interface InvitesCreated {
  invites: InviteDTO[];
  failed: string[];
  reused: string[];
}

export interface DomainDTO {
  id: string;
  hostname: string;
  status: "checking_dns" | "issuing_tls" | "active" | "error";
  statusReason: string;
  rootRedirect: string;
  /** "txt" for a domain moving from another service (#383): it is checked
   * through TXT records, so it can be ready before its CNAME switches. */
  validation: "http" | "txt";
  createdAt: number;
  checkUntil: number | null;
  /** A locked domain keeps serving until the org's `graceEndsAt` (#159). */
  lockedAt: number | null;
}

export interface AppConfig {
  appHost: string;
  linkHost: string;
  emailEnabled: boolean;
  googleEnabled: boolean;
  turnstileSiteKey?: string;
}

/** The timestamp lets the client drop an out-of-order mutation response: racing mutations can answer opposite to their D1 writes. */
export interface QuotaUsage {
  quotaUsage: number;
  quotaUsageAt: number;
}

/** The write already knows the count, so the client skips the follow-up GET /links/quota-usage (#100). */
export type WithQuotaUsage<T> = T & QuotaUsage;

/** `key` is the raw value, present only in the create response. */
export interface ApiKeyDTO {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  key?: string;
}

export interface LinkDTO extends QrOverrides {
  id: string;
  domainId: string | null;
  domain: string | null;
  slug: string;
  url: string;
  destination: string;
  title: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
  createdAt: number;
  clicks: number;
  addressCount: number;
  createdBy: string | null;
  suspendedAt: number | null;
}

export const LINK_FILTERS = ["all", "attention", "custom"] as const;
export type LinkFilter = (typeof LINK_FILTERS)[number];

export interface LinkFacets {
  all: number;
  attention: number;
  customDomain: number;
}

export interface LinkListItem extends LinkDTO {
  spark: number[];
  attention: string | null;
}

export interface AddressDTO {
  id: string;
  domainId: string | null;
  domain: string | null;
  slug: string;
  url: string;
  kind: "primary" | "temp_alias" | "permanent_alias";
  creationReason: "created" | "renamed" | "promoted" | "same_destination_merge" | "";
  expiresAt: number | null;
  retiredAt: number | null;
  createdAt: number;
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
  forceSeparateLink?: boolean;
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
  pct: number | null;
}

export interface StatsLinkRef {
  id: string;
  slug: string;
  title: string;
  domain: string | null;
}

export interface OrgStats {
  totalClicks: number;
  totalLinks: number;
  clicks7d: number;
  rangeDays: number; // analytics window for this org's plan
  bucket: "day" | "hour";
  series: SeriesPoint[];
  hourSeries: SeriesPoint[];
  totalClicksDelta: DeltaValue | null;
  clicks7dDelta: DeltaValue | null;
  topLinks: (StatsLinkRef & { clicks: number })[];
  /** The empty Analytics page rests on this, not on the range's own lists. */
  everClicked: boolean;
  countries: TopEntry[];
  referrers: TopEntry[];
  devices: TopEntry[];
  deadLinks: StatsLinkRef[];
  decayingLinks: (StatsLinkRef & { drop: number })[];
  heatmap: HeatmapRow[];
  campaigns: { campaign: string; clicks: number }[];
  sources: { source: string; clicks: number }[];
  mediums: { medium: string; clicks: number }[];
  linksClicked: number;
  linksClickedDelta: DeltaValue | null;
  /** Countries the edge could not place are left out. */
  countryCount: number;
}

export type OrgInsight =
  | {
      kind: "country";
      country: string;
      current: number;
      previous: number;
      pct: number;
    }
  | {
      kind: "link_fell";
      link: StatsLinkRef;
      current: number;
      previous: number;
      pct: number;
    }
  | {
      kind: "first_referrer";
      link: StatsLinkRef;
      referrer: string;
      clicks: number;
      since: string;
    };

export interface OrgInsights {
  days: number;
  insights: OrgInsight[];
  minor: OrgInsight | null;
}

export interface HeatmapRow {
  dayOfWeek: number;
  hour: number;
  clicks: number;
}

export interface RecentClick {
  id: number;
  ts: number;
  country: string;
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
  url: string;
  destination: string;
  title: string;
  createdAt: number;
  lastClick: number | null;
  createdBy: string | null;
  /** Countries the edge could not place are left out. */
  countryCount: number;
  campaigns: { campaign: string; clicks: number }[];
}

export interface AdminUsage {
  users: number;
  orgs: number;
  links: number;
  clicks: number;
  clicks7d: number;
  payingUsers: number;
  days: number;
  series: SeriesPoint[];
  signups: SeriesPoint[];
  /** Links deleted since are not counted: nothing records them. */
  linkSeries: SeriesPoint[];
  signupsByPlan: { free: number; hobby: number; pro: number };
  topOrgs: { id: string; name: string; clicks: number; plan: OrgPlan }[];
  topLinks: {
    id: string;
    slug: string;
    domain: string | null;
    orgName: string;
    clicks: number;
  }[];
  /** Counts, never money (#82): revenue is read in the Polar dashboard, net of discounts, tax and refunds. */
  planCounts: { free: number; hobby: number; pro: number; enterprise: number };
  payingSubscribers: number;
  compedUsers: number;
  paidConversionRate: number | null;
  signups7d: number;
  signups7dDelta: DeltaValue | null;
  wau: number;
  cumulativeUsers: SeriesPoint[];
  cumulativeOrgs: SeriesPoint[];
  botSeries: SeriesPoint[];
  anomalies: AnomalyEntry[];
  capPressure: CapPressureEntry[];
  tableSize: number;
  tableGrowth: SeriesPoint[];
  tableProjectedDays: number | null;
  webRisk: { today: number; month: number; perDay: number };
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
  clicks30d: number;
  overPlan: boolean;
  graceEndsAt: number | null;
  lockedAt: number | null;
  domainStoppedAt: number | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  disabledAt: number | null;
  linksSuspendedAt: number | null;
  suspendReason: string | null;
  reviewFlaggedAt: number | null;
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

export interface AdminLinkRow {
  id: string;
  slug: string;
  domain: string | null;
  url: string;
  destination: string;
  orgId: string;
  orgName: string;
  createdBy: string | null;
  createdAt: number;
  clicks: number;
  suspendedAt: number | null;
  suspendReason: string | null;
  warnedAt: number | null;
  warnReason: string | null;
  riskScore: number | null;
  riskReasons: string[];
  riskCheckedAt: number | null;
  reportCount: number;
}

export interface AdminBlockedHostRow {
  host: string;
  reason: string;
  createdAt: number;
}

export interface AdminReportRow {
  id: string;
  slug: string;
  linkId: string | null;
  orgId: string | null;
  orgName: string | null;
  reason: ReportReason;
  note: string;
  contact: string;
  createdAt: number;
  anonymous: boolean;
}

/** No org and no owner, so it cannot share AdminLinkRow's shape. */
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

export const ADMIN_LINK_SORTS = ["created", "clicks", "risk"] as const;
export type AdminLinkSort = (typeof ADMIN_LINK_SORTS)[number];

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  banned: boolean;
  emailVerified: boolean;
  disposable: boolean;
  news: ConsentAnswer;
  offers: ConsentAnswer;
  plan: StoredPlan;
  /** What Polar says, separately from what the user may do. */
  subscriptionPlan: Exclude<StoredPlan, "free"> | null;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  compPlan: Exclude<StoredPlan, "free"> | null;
  compReason: string | null;
  compGrantedAt: number | null;
  compGrantedBy: string | null;
  limitOverrides: LimitOverrides | null;
  tier: AccountTier;
  limitNote: string | null;
  limitSetBy: string | null;
  createdAt: number;
  orgCount: number;
  links: number;
  image: string | null;
  lastSeen: number | null;
}

export interface AdminLinkCounts {
  all: number;
  reported: number;
  flagged: number;
  suspended: number;
  warned: number;
}

export interface InvitePreview {
  orgName: string;
  role: OrgRole;
  invitedBy: string | null;
}

export type Sort = { key: string; dir: 1 | -1 };

/** Empty for anybody Polar has no customer for. */
export interface BillingDetails {
  card: PaymentCard | null;
  invoices: Invoice[];
}

export interface PaymentCard {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface Invoice {
  id: string;
  date: number;
  plan: (typeof COMP_PLANS)[number] | null;
  amountCents: number;
  currency: string;
  status: "paid" | "open" | "refunded" | "credit";
  pdfUrl: string | null;
}
