import { expect } from "vitest";
import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  waitOnExecutionContext,
} from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import worker from "../../src/worker";
import * as schema from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import type { ClickMessage } from "../../src/worker/clicks";
import type { StorageMessage } from "../../src/worker/storage";
import { hashPassword } from "../../src/worker/password";

// The ambient worker-test binding, under the same name the worker knows it by
// (env.d.ts declares Cloudflare.Env as our own Env, so this needs no cast).
export const testEnv: Env = env;

export function overrideEnv(overrides: Partial<Env>): Env {
  return { ...testEnv, ...overrides };
}

// Backlog numbers nothing asserts on: a stub queue has no backlog.
const noBacklog = { backlogCount: 0, backlogBytes: 0 };

/**
 * A queue binding that hands every message to `onSend` instead of delivering
 * it, so a producer's fan-out can be asserted without a live consumer running
 * in the same test. Throw from `onSend` to make the send itself fail.
 */
export function stubQueue<Body>(onSend: (body: Body) => void): Queue<Body> {
  return {
    async metrics() {
      return noBacklog;
    },
    async send(message) {
      onSend(message);
      return { metadata: { metrics: noBacklog } };
    },
    async sendBatch(messages) {
      for (const m of messages) onSend(m.body);
      return { metadata: { metrics: noBacklog } };
    },
  };
}

/**
 * A CLICK_QUEUE that records what was sent, so the redirect path's enqueue
 * can be asserted without a live queue delivering the message back into the
 * worker under test (consumption is covered by tests/worker/clicks.worker.ts).
 */
export function captureClickQueue() {
  const sent: ClickMessage[] = [];
  const CLICK_QUEUE = stubQueue<ClickMessage>((m) => sent.push(m));
  return { env: overrideEnv({ CLICK_QUEUE }), sent };
}

// Env with a non-empty auth secret, independent of the ambient .dev.vars, so
// sign-in's rate-limit key derivation has a key to HMAC with.
/**
 * The default binding for worker tests: a known BETTER_AUTH_SECRET, and Cap
 * explicitly off.
 *
 * Cap has to be cleared rather than merely unmentioned, because the ambient
 * binding is built from .dev.vars, which sets CAP_SECRET so the browser tests
 * exercise the real proof-of-work loop (#98). Inheriting it here would make
 * every signup in every worker test fail the Cap check first and report 400,
 * hiding whatever that test was actually about. Tests that want Cap on say so:
 * see cap.worker.ts.
 */
export const authEnv = () =>
  overrideEnv({ BETTER_AUTH_SECRET: "test-secret", CAP_SECRET: undefined });

/**
 * Drive one request through the real worker and wait for anything it
 * deferred with waitUntil (click enqueues, storage sends) before returning,
 * so a test can assert on those without racing them.
 *
 * Defaults to authEnv() rather than the ambient env: it is the same binding
 * with a known BETTER_AUTH_SECRET, which is what cookies from
 * signInCookie()/adminCookie() are signed against. Tests needing a different
 * binding pass one.
 */
export async function fetchWorker(request: Request, testEnv: Env = authEnv()): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

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

/** One outbound Resend send, as the worker posted it. */
export interface CapturedEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Captures what would go to Resend, and optionally answers the MX lookup
 * signup does.
 *
 * `sendEmail()` and `domainHasMailRecords()` both post with plain `fetch`
 * (the Resend SDK cannot repoint its base URL, which is what keeps the local
 * emulator flow working), so replacing the global is the honest seam: the
 * request under assertion is the one the worker would really send.
 *
 * `mx` answers the DNS lookup too, so a test decides which domains can
 * receive mail rather than the network.
 *
 * `hold` keeps the send hanging until that promise resolves, which is how a
 * test proves the worker answered without waiting for Resend. `started()`
 * reports whether the send was reached at all.
 */
export function captureEmails({
  mx,
  hold,
}: { mx?: "deliverable" | "unroutable"; hold?: Promise<void> } = {}) {
  const sent: CapturedEmail[] = [];
  let started = false;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/emails")) {
      started = true;
      // SAFETY: the only caller of this branch is sendEmail(), which posts a
      // JSON body of exactly these four fields to Resend.
      sent.push(JSON.parse(String(init?.body ?? "{}")) as CapturedEmail);
      if (hold) await hold;
      return Response.json({ id: "sent" });
    }
    if (mx && url.includes("cloudflare-dns.com")) {
      const Answer = mx === "deliverable" ? [{ data: "10 mx.example." }] : [];
      return Response.json({ Status: 0, Answer });
    }
    return original(input, init);
  };
  return { sent, started: () => started, restore: () => (globalThis.fetch = original) };
}

/** The `user-1` row the billing and entitlement suites both write against,
 * with only the columns under test spelled out at the call site. */
export async function seedBillingUser(
  overrides: Partial<typeof schema.user.$inferInsert> = {},
): Promise<void> {
  await drizzle(env.DB, { schema })
    .insert(schema.user)
    .values({
      id: "user-1",
      name: "Test User",
      email: "user1@example.com",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...overrides,
    });
}

export async function applyTestMigrations(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
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
const rawLinkDefaults: Partial<typeof schema.links.$inferInsert> = {
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
  qrLogoSize: null,
  createdBy: null,
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
const rawAddressDefaults: Partial<typeof schema.linkAddresses.$inferInsert> = {
  domainId: null,
  creationReason: "",
  expiresAt: null,
  retiredAt: null,
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
export const sampleAddress: Omit<typeof schema.linkAddresses.$inferInsert, "createdAt"> = {
  id: "addr-1",
  linkId: "link-1",
  orgId: "org-1",
  domainId: null,
  slug: "sale",
  kind: "primary",
  creationReason: "",
  expiresAt: null,
  retiredAt: null,
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

/**
 * Reads a response body as the shape the route under test is documented to
 * return. Kept in one place so the tests do not repeat the same cast at every
 * call site.
 */
export async function jsonBody<T>(res: Response): Promise<T> {
  // SAFETY: the caller names the shape it is about to assert on, and the
  // assertions are what check it: a route that stops returning that shape
  // fails the test rather than passing quietly.
  return (await res.json()) as T;
}

/** The schema-bound drizzle client every worker test reaches for. */
export function testDb() {
  return drizzle(env.DB, { schema });
}

export async function addressById(addressId: string) {
  const [row] = await testDb()
    .select()
    .from(schema.linkAddresses)
    .where(eq(schema.linkAddresses.id, addressId));
  return row;
}

export async function addressesOf(linkId: string) {
  return testDb()
    .select()
    .from(schema.linkAddresses)
    .where(eq(schema.linkAddresses.linkId, linkId));
}

// A queue that records what was sent instead of delivering it, so a route's
// KV-sync fan-out can be asserted without a live queue consumer running inside
// the same test.
export function captureStorageQueue() {
  const sent: StorageMessage[] = [];
  return { queue: stubQueue<StorageMessage>((m) => sent.push(m)), sent };
}

// Builds a real MessageBatch via the official cloudflare:test helpers, so ack/
// retry/dead-letter assertions exercise the same runtime semantics production
// queue delivery does, rather than hand-rolled spies.
export function batchOf<Body>(queueName: string, bodies: Body[], attempts = 1) {
  const batch = createMessageBatch<Body>(
    queueName,
    bodies.map((body, i) => ({ id: `m${i}`, timestamp: new Date(), attempts, body })),
  );
  const ctx = createExecutionContext();
  return { batch, ctx };
}

/**
 * Stub rate-limit bindings.
 *
 * Cloudflare's per-location counters do not reset between test cases, so a
 * test that wants "this budget is gone" says so with a binding rather than by
 * spending a real one.
 */
export function exhaustedLimit(): RateLimit {
  return { limit: async () => ({ success: false }) };
}

/** Always allows, isolating which of several budgets is under test. */
export function openLimit(): RateLimit {
  return { limit: async () => ({ success: true }) };
}

/** Allows, and records the key each call was counted against. */
export function recordingLimit(keys: string[]): RateLimit {
  return {
    limit: async (options) => {
      keys.push(String(options?.key));
      return { success: true };
    },
  };
}
