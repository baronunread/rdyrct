import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./db/schema";
import type { StorageMessage } from "./storage";
import type { ClickBuffer } from "./click-buffer";
import type { BillingProvider } from "./billing-provider";
import type { AuditableLogger } from "evlog";
import type { OrgPlan } from "@/shared/types";

export interface Env {
  DB: D1Database;
  LINKS: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;

  STORAGE_QUEUE: Queue<StorageMessage>;
  ORG_DELETE: Workflow<{ orgId: string }>;
  DOMAIN_ACTIVATE: Workflow<{ domainId: string; hostname: string }>;
  LINK_IMPORT: Workflow<{ importId: string }>;
  NEWSLETTER_SEND: Workflow<{ sendId: string }>;
  CLICK_BUFFER: DurableObjectNamespace<ClickBuffer>;
  RATE_LIMIT: RateLimit;

  BETTER_AUTH_SECRET: string;
  SUPERADMIN_EMAIL: string;
  RESEND_API_KEY?: string; // unset: no email goes out and sign-up skips verification
  MAIL_FROM: string; // var, e.g. "me <no-reply@mail.rdyrct.com>"
  // var. Sender of the founder welcome email; unset, no welcome is sent: its text is in one person voice, which a self-hosted instance has no right to borrow.
  WELCOME_FROM?: string;
  // var. Sender of every newsletter, on its own subdomain so a marketing complaint cannot reach MAIL_FROM reputation. Unset, a send is refused.
  NEWSLETTER_FROM?: string;
  // var, optional: the sending subdomain has no inbox, so without it a reply bounces.
  NEWSLETTER_REPLY_TO?: string;
  // var, optional: printed under every newsletter unsubscribe link (US CAN-SPAM asks for one).
  POSTAL_ADDRESS?: string;
  APP_URL: string; // var, e.g. "https://rdyrct.com"; SPA/API origin
  RESEND_BASE_URL?: string; // var; dev points at the emulate.dev Resend emulator

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_EMULATOR_URL?: string;

  POLAR_ACCESS_TOKEN?: string;
  POLAR_WEBHOOK_SECRET?: string;
  POLAR_PRO_PRODUCT_ID?: string;
  POLAR_HOBBY_PRODUCT_ID?: string;
  POLAR_PRO_YEARLY_PRODUCT_ID?: string; // var, yearly (10% off)
  POLAR_HOBBY_YEARLY_PRODUCT_ID?: string;
  POLAR_SERVER?: "sandbox" | "production"; // var, default sandbox
  // injected by tests; unset everywhere else, where the routes build a real Polar client
  BILLING?: BillingProvider;

  APP_HOST: string; // var, e.g. "rdyrct.com"; the app/API origin and CNAME target
  // var, self-hosted copies only: what every tab is titled. Unset, the tab says the host the copy answers on.
  SITE_NAME?: string;
  // var, e.g. rdyr.cc: the shorter host for new shared-domain links. Both hosts read the same KV keys, since a shared slug key has no host. Unset means APP_HOST.
  SHARED_LINK_HOST?: string;
  CF_API_TOKEN?: string; // secret, Custom Hostnames edit
  CF_ZONE_ID?: string;
  // var, dev/test only: fakes the Custom Hostnames API. "simulated" walks a domain through
  // the states on a timer, "instant" is ready at once. Any other value calls the real API.
  CF_DEV_ENV?: string;

  // bot protection (#304): a secret unset disables the check.
  TURNSTILE_SITE_KEY?: string; // secret, though public: /api/config serves it
  TURNSTILE_SECRET_KEY?: string; // secret

  // destination check (#341): unset skips Web Risk; the Cloudflare DNS check still runs.
  WEB_RISK_API_KEY?: string; // secret, a GCP API key restricted to the Web Risk API

  // click buffer flush interval in ms, e2e only. Unset means 10 s.
  CLICK_FLUSH_MS?: string; // var

  // A secret, not a var: a public DSN lets every clone of this repo report into our project.
  SENTRY_DSN?: string; // secret, from sentry.io project settings
}

export type DB = DrizzleD1Database<typeof schema>;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  emailVerified: boolean;
  plan: OrgPlan;
  polarSubscriptionCancelAtPeriodEnd: boolean;
  polarSubscriptionCurrentPeriodEnd: number | null;
  polarSubscriptionInterval: "month" | "year" | null;
  image: string | null;
}

export type Vars = {
  db: DB;
  user: SessionUser | null;
  log: AuditableLogger;
};

export type AppEnv = { Bindings: Env; Variables: Vars };
