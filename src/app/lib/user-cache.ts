// A hint, never the truth: `useCurrentUser` seeds itself from this and refetches
// straight away (`initialDataUpdatedAt: 0`). Nothing here is authorization.
// Failures are silent: a browser with storage disabled just shows the skeleton.
import * as v from "valibot";
import { ORG_PLANS, ORG_ROLES, type CurrentUser } from "@/shared/types";

const KEY = "rdyrct:user:v2";

const limitsSchema = v.object({
  orgs: v.number(),
  links: v.number(),
  members: v.number(),
  domains: v.number(),
  qrCustom: v.boolean(),
  analyticsDays: v.number(),
  trackedClicks: v.number(),
});

const planField = v.picklist(ORG_PLANS);
const tierField = v.picklist([...ORG_PLANS, "enterprise"]);

const userSchema = v.object({
  id: v.string(),
  email: v.string(),
  name: v.string(),
  isAdmin: v.boolean(),
  emailVerified: v.boolean(),
  plan: planField,
  tier: tierField,
  limits: limitsSchema,
  polarSubscriptionCancelAtPeriodEnd: v.boolean(),
  polarSubscriptionCurrentPeriodEnd: v.nullable(v.number()),
  polarSubscriptionInterval: v.nullable(v.picklist(["month", "year"])),
  hasBillingAccount: v.boolean(),
  comped: v.boolean(),
  image: v.nullable(v.string()),
  // Parsed so the record stays whole. Never read from the cache: the dialog
  // and the Settings toggle wait for the real answer (useCurrentUser).
  marketing: v.object({ news: v.boolean(), offers: v.boolean(), asked: v.boolean() }),
  // Optional so a cache written before the field existed still paints.
  marketingOffered: v.optional(v.boolean(), false),
});

const orgSchema = v.object({
  id: v.string(),
  name: v.string(),
  role: v.picklist(ORG_ROLES),
  plan: planField,
  tier: tierField,
  limits: limitsSchema,
  defaultDomainId: v.nullable(v.string()),
  qrLogo: v.string(),
  qrStyle: v.string(),
  qrColor: v.string(),
  qrCorner: v.string(),
  qrBg: v.string(),
  qrEyeColor: v.string(),
  qrLogoSize: v.nullable(v.number()),
  // Entitlement state (#158). A cached copy is chrome, same as the rest of
  // this record: the query behind it corrects the banner the moment it lands.
  locked: v.boolean(),
  over: v.object({
    links: v.optional(v.number()),
    members: v.optional(v.number()),
    domains: v.optional(v.number()),
  }),
  graceEndsAt: v.nullable(v.number()),
});

// Whole-record or nothing: a half-parsed user would render a shell with blanks.
const cachedUserSchema = v.object({ user: userSchema, orgs: v.array(orgSchema) });

export function readCachedUser(): CurrentUser | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = v.safeParse(cachedUserSchema, JSON.parse(raw));
    return parsed.success ? parsed.output : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedUser(user: CurrentUser | null) {
  try {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else localStorage.removeItem(KEY);
  } catch {}
}

export const readAuthHint = () => readCachedUser() !== undefined;
