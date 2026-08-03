import { expect } from "vitest";
import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  waitOnExecutionContext,
} from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import { hashPassword } from "../../src/worker/password";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };

export function overrideEnv(overrides: Partial<Env>): Env {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property in overrides) return overrides[property as keyof Env];
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as Env;
}

// Env with a non-empty auth secret, independent of the ambient .dev.vars, so
// sign-in's rate-limit key derivation has a key to HMAC with.
export const authEnv = () => overrideEnv({ BETTER_AUTH_SECRET: "test-secret" });

// Deterministic Polar product ids and webhook secret for billing tests,
// independent of the ambient .dev.vars. Keeps the same auth secret as
// authEnv() so a cookie minted via signInCookie()/adminCookie() still
// validates on requests made with this env.
export const POLAR_HOBBY_PRODUCT_ID = "prod_hobby";
export const POLAR_PRO_PRODUCT_ID = "prod_pro";
export const POLAR_WEBHOOK_SECRET = "test-webhook-secret";
export const billingEnv = () =>
  overrideEnv({
    BETTER_AUTH_SECRET: "test-secret",
    POLAR_WEBHOOK_SECRET,
    POLAR_HOBBY_PRODUCT_ID,
    POLAR_PRO_PRODUCT_ID,
  });

export async function applyTestMigrations(): Promise<void> {
  const testEnv = env as TestEnv;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
}

// The password every seeded test user shares: fine since each test's DB is
// wiped between runs and nothing depends on a real secret.
export const TEST_PASSWORD = "correct-horse-battery";

// Signs in a previously-seeded user and returns a cookie header ready to
// attach to a follow-up request.
export async function signInCookie(email: string, password: string): Promise<string> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

// Seeds a platform admin and signs in, returning a cookie header ready to
// attach to a follow-up request.
export async function adminCookie(): Promise<string> {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('admin-1', 'Admin', 'admin@example.com', 1, 1, 'pro', 0, 0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-1', 'admin-1', 'credential', 'admin-1', ?, 0, 0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
  ]);
  return signInCookie("admin@example.com", TEST_PASSWORD);
}

// A real (non-admin) free-plan user who owns "org-1" — unlike adminCookie(),
// which is both a platform admin and on the pro plan, so it bypasses checks
// tests often want exercised (org membership, paid-plan gates). Pass `domain`
// to also seed an active custom domain for that org.
export async function freeOwnerCookie(domain?: { id: string; hostname: string }): Promise<string> {
  const statements = [
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('free-1', 'Free', 'free@example.com', 1, 0, 'free', 0, 0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-free-1', 'free-1', 'credential', 'free-1', ?, 0, 0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Test', 0)"),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'free-1', 'owner', 0)",
    ),
  ];
  if (domain)
    statements.push(
      env.DB.prepare(
        "insert into domains (id, org_id, hostname, status, created_at) values (?, 'org-1', ?, 'active', 0)",
      ).bind(domain.id, domain.hostname),
    );
  await env.DB.batch(statements);
  return signInCookie("free@example.com", TEST_PASSWORD);
}

export const sampleLink = {
  id: "link-1",
  orgId: "org-1",
  slug: "sale",
  destination: "https://example.com",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
};

// Every links column beyond the ones a test usually cares about
// (id/orgId/slug/destination/createdAt), spelled out because raw D1 inserts
// (unlike the API route) don't fall back to the schema's column defaults for
// columns left out of a batch insert alongside other rows that do specify
// them. Tests that need a raw `links` row — bypassing the API to seed data
// directly — spread this in and override just what they're testing.
const rawLinkDefaults = {
  title: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  utmTerm: "",
  utmContent: "",
  qrLogo: "",
  qrStyle: "",
  qrColor: "",
  qrCorner: "",
  qrBg: "",
  qrEyeColor: "",
  qrLogoSize: null as number | null,
  createdBy: null as string | null,
};

export function rawLinkRow(
  row: Pick<
    typeof schema.links.$inferInsert,
    "id" | "orgId" | "slug" | "destination" | "createdAt"
  > &
    Partial<typeof schema.links.$inferInsert>,
): typeof schema.links.$inferInsert {
  return { ...rawLinkDefaults, ...row };
}

// Same idea as rawLinkDefaults, for a raw `link_addresses` row.
const rawAddressDefaults = {
  domainId: null as string | null,
  creationReason: "" as const,
  expiresAt: null as number | null,
  retiredAt: null as number | null,
};

export function rawAddressRow(
  row: Pick<
    typeof schema.linkAddresses.$inferInsert,
    "id" | "linkId" | "orgId" | "slug" | "kind" | "createdAt"
  > &
    Partial<typeof schema.linkAddresses.$inferInsert>,
): typeof schema.linkAddresses.$inferInsert {
  return { ...rawAddressDefaults, ...row };
}

// The primary address row every link carries alongside it (see #38): a slug
// only resolves via link_addresses now, so seedLink() must create this row
// too, not just the links row.
export const sampleAddress = {
  id: "addr-1",
  linkId: "link-1",
  orgId: "org-1",
  domainId: null as string | null,
  slug: "sale",
  kind: "primary" as const,
  creationReason: "" as const,
  expiresAt: null as number | null,
  retiredAt: null as number | null,
};

// Seeds one org ("org-1"), one link ("link-1", slug "sale"), and that link's
// primary address row ("addr-1") — the fixture shared by tests that need a
// real link row to satisfy a foreign key (clicks, KV publish) without caring
// about its other fields.
export async function seedLink(destination = "https://example.com") {
  const db = drizzle(env.DB, { schema });
  await db.batch([
    db.insert(schema.orgs).values({ id: "org-1", name: "Test", createdAt: 0 }),
    db.insert(schema.links).values({ ...sampleLink, destination, createdAt: 0 }),
    db.insert(schema.linkAddresses).values({ ...sampleAddress, createdAt: 0 }),
  ]);
  return db;
}

// Builds a real MessageBatch via the official cloudflare:test helpers, so ack/
// retry/dead-letter assertions exercise the same runtime semantics production
// queue delivery does, rather than hand-rolled spies.
export function batchOf<Body>(queueName: string, bodies: Body[], attempts = 1) {
  const batch = createMessageBatch(
    queueName,
    bodies.map((body, i) => ({ id: `m${i}`, timestamp: new Date(), attempts, body })),
  );
  const ctx = createExecutionContext();
  return { batch, ctx };
}
