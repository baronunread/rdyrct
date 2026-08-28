/**
 * The last /user answer, kept in localStorage so a reload paints the app
 * shell instead of a skeleton.
 *
 * Without it every reload of /links or /analytics blanked the sidebar, the
 * org switcher and the user footer until a round trip came back, which is a
 * whole second of an app that looks like it is still booting. The shell is
 * the same for this person on every page; only the page under it needs to
 * wait for data.
 *
 * A hint, never the truth: `useCurrentUser` seeds itself from this and
 * refetches straight away (`initialDataUpdatedAt: 0`), so a session that has
 * since expired lands on /login one round trip later. Nothing here is
 * authorization: the server checks every request regardless of what this
 * browser believes about itself.
 *
 * Failures are silent. A browser with storage disabled still works, it just
 * shows the skeleton it always did.
 */
import * as v from "valibot";
import { ORG_PLANS, ORG_ROLES, type CurrentUser } from "@/shared/types";

const KEY = "rdyrct:user:v1";

const planField = v.picklist(ORG_PLANS);

const userSchema = v.object({
  id: v.string(),
  email: v.string(),
  name: v.string(),
  isAdmin: v.boolean(),
  emailVerified: v.boolean(),
  plan: planField,
  polarSubscriptionCancelAtPeriodEnd: v.boolean(),
  polarSubscriptionCurrentPeriodEnd: v.nullable(v.number()),
  hasBillingAccount: v.boolean(),
  comped: v.boolean(),
  image: v.nullable(v.string()),
});

const orgSchema = v.object({
  id: v.string(),
  name: v.string(),
  role: v.picklist(ORG_ROLES),
  plan: planField,
  defaultDomainId: v.nullable(v.string()),
  qrLogo: v.string(),
  qrStyle: v.string(),
  qrColor: v.string(),
  qrCorner: v.string(),
  qrBg: v.string(),
  qrEyeColor: v.string(),
  qrLogoSize: v.nullable(v.number()),
  // Entitlement state (#158). A cached copy is chrome, same as the rest of
  // this record: the banner it paints is one page load old, and the query
  // behind it corrects the moment it lands.
  locked: v.boolean(),
  over: v.object({
    links: v.optional(v.number()),
    members: v.optional(v.number()),
    domains: v.optional(v.number()),
  }),
  graceEndsAt: v.nullable(v.number()),
});

/** Whole-record or nothing: a half-parsed user would render a shell with
 * blanks in it, which is worse than the skeleton this replaces. */
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
  } catch {
    /* ignore */
  }
}

/**
 * Whether this browser was signed in last time it asked, for the landing
 * header's first paint (Dashboard vs Sign up) before /user resolves.
 */
export const readAuthHint = () => readCachedUser() !== undefined;
