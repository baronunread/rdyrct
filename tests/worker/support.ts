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

export async function applyTestMigrations(): Promise<void> {
  const testEnv = env as TestEnv;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
}

// Seeds a platform admin and signs in, returning a cookie header ready to
// attach to a follow-up request.
export async function adminCookie(): Promise<string> {
  const password = "correct-horse-battery";
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('admin-1', 'Admin', 'admin@example.com', 1, 1, 'pro', 0, 0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-1', 'admin-1', 'credential', 'admin-1', ?, 0, 0)",
    ).bind(await hashPassword(password)),
  ]);
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password }),
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

// Seeds one org ("org-1") and one link ("link-1", slug "sale"), the fixture
// shared by tests that need a real link row to satisfy a foreign key
// (clicks, KV publish) without caring about its other fields.
export async function seedLink(destination = "https://example.com") {
  const db = drizzle(env.DB, { schema });
  await db.batch([
    db.insert(schema.orgs).values({ id: "org-1", name: "Test", createdAt: 0 }),
    db.insert(schema.links).values({ ...sampleLink, destination, createdAt: 0 }),
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
