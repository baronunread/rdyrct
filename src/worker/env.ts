import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./db/schema";
import type { StorageMessage } from "./storage";

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
  RL_AUTH_PUBLIC: RateLimit;
  RL_EMAIL: RateLimit;
  RL_WRITE_FREE: RateLimit;
  RL_WRITE_PAID: RateLimit;
  RL_QR_UPLOAD: RateLimit;
  RL_DOMAIN_SETUP: RateLimit;
  RL_BILLING: RateLimit;
  RL_CLICK_RECORDING: RateLimit;

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

  /* custom domains (Cloudflare for SaaS) */
  APP_HOST: string; // var, e.g. "rdyrct.com"; the shared redirect host
  CF_API_TOKEN?: string; // secret, Custom Hostnames edit
  CF_ZONE_ID?: string; // var
  DEV_FAKE_CF?: string; // var, "1" fakes the CF API in local dev

  /* alerting: dead-lettered storage messages (best-effort, never blocks acking) */
  BETTERSTACK_SOURCE_TOKEN?: string; // secret
  BETTERSTACK_INGEST_URL?: string; // var, e.g. https://in.logs.betterstack.com
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
};

export type AppEnv = { Bindings: Env; Variables: Vars };
