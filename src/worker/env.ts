import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./db/schema";
import type { StorageMessage } from "./storage";
import type { ClickMessage } from "./clicks";
import type { BillingProvider } from "./billing-provider";
import type { AuditableLogger } from "evlog";

export interface Env {
  DB: D1Database;
  LINKS: KVNamespace;
  QR_LOGOS: R2Bucket;
  ASSETS: Fetcher;

  /* storage recovery: KV/R2 follow-up work and the org-teardown workflow */
  STORAGE_QUEUE: Queue<StorageMessage>;
  ORG_DELETE: Workflow<{ orgId: string }>;
  /* custom-domain activation as a durable background workflow */
  DOMAIN_ACTIVATE: Workflow<{ domainId: string; hostname: string }>;
  /* click ingestion: redirects enqueue instead of writing D1 directly */
  CLICK_QUEUE: Queue<ClickMessage>;
  RL_AUTH_PUBLIC: RateLimit;
  /* Cap's challenge and redeem endpoints (#98), on their own budget: issuing
     a challenge is cheap for us and the proof-of-work is what costs the
     caller, so this must never be the thing a person meets. */
  RL_CAP: RateLimit;
  RL_EMAIL: RateLimit;
  RL_EMAIL_RECIPIENT: RateLimit;
  RL_WRITE_FREE: RateLimit;
  RL_WRITE_PAID: RateLimit;
  RL_QR_UPLOAD: RateLimit;
  RL_DOMAIN_SETUP: RateLimit;
  RL_BILLING: RateLimit;
  RL_CLICK_RECORDING: RateLimit;
  /* the landing page's anonymous shortener (Direction A of #96) */
  RL_ANON_LINK: RateLimit;

  /* auth + email (secrets unless noted) */
  BETTER_AUTH_SECRET: string;
  SUPERADMIN_EMAIL: string;
  RESEND_API_KEY: string;
  MAIL_FROM: string; // var, e.g. "rdyrct <no-reply@mail.rdyrct.com>"
  APP_URL: string; // var, e.g. "https://rdyrct.com"; SPA/API origin
  RESEND_BASE_URL?: string; // var; dev points at the emulate.dev Resend emulator

  /* billing (Polar) */
  POLAR_ACCESS_TOKEN: string;
  POLAR_WEBHOOK_SECRET: string;
  POLAR_PRO_PRODUCT_ID: string; // var
  POLAR_HOBBY_PRODUCT_ID: string; // var
  POLAR_SERVER?: "sandbox" | "production"; // var, default sandbox
  /* the checkout/portal client, injected by tests; unset everywhere else,
     where the routes build a real Polar client from the token above */
  BILLING?: BillingProvider;

  /* custom domains (Cloudflare for SaaS) */
  APP_HOST: string; // var, e.g. "rdyrct.com"; the shared redirect host
  CF_API_TOKEN?: string; // secret, Custom Hostnames edit
  CF_ZONE_ID?: string; // var
  // var, dev/test only: fakes the Custom Hostnames API. "simulated" walks a
  // new domain through checking_dns and issuing_tls on a timer, so both states
  // are visible in a browser; "instant" reports both ready at once, for e2e
  // runs that assert on the end state and should not wait out a staged delay.
  // Any other value (including unset) calls the real API, or fails closed.
  CF_DEV_ENV?: string;

  /* bot protection: Cap proof-of-work (#98). Unset disables the check. */
  CAP_SECRET?: string; // secret, `openssl rand -hex 32`

  /* error tracking: unset disables capture (see sentry.ts, index.ts) */
  SENTRY_DSN?: string; // var, from sentry.io project settings
}

export type DB = DrizzleD1Database<typeof schema>;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  emailVerified: boolean;
  plan: "free" | "hobby" | "pro";
  polarSubscriptionCancelAtPeriodEnd: boolean;
  polarSubscriptionCurrentPeriodEnd: number | null;
}

export type Vars = {
  db: DB;
  user: SessionUser | null;
  /** Request-scoped evlog wide-event logger, set by the evlog middleware. */
  log: AuditableLogger;
};

export type AppEnv = { Bindings: Env; Variables: Vars };
