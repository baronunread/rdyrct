import { expect } from "vitest";
import * as v from "valibot";
import type { BillingProvider } from "../../src/worker/billing-provider";
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
import type { RateLimitBucket } from "../../src/worker/rate-limit";
import { lookup } from "../../src/shared/lookup";
import type { ClickMessage } from "../../src/worker/clicks";
import type { ClickBuffer } from "../../src/worker/click-buffer";
import type { StorageMessage } from "../../src/worker/storage";
import { hashPassword } from "../../src/worker/password";

const SPA_SHELL = `<!doctype html><html><head><title>rdyrct - branded short links for your team</title></head><body><div id="root"></div></body></html>`;

const SHORT_404 = `<!doctype html><html><head><title>Not found</title></head><body data-page="404-short"><div id="root"><h1>No link at this address.</h1><p><a href="/">Go home</a></p></div></body></html>`;

const stubAssets: Fetcher = {
  fetch: async (input) =>
    new Response(
      new URL(new Request(input).url).pathname === "/404-short" ? SHORT_404 : SPA_SHELL,
      {
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    ),
  connect: () => {
    throw new Error("ASSETS.connect: the asset bundle serves requests, not sockets");
  },
};

// workers-types overloads createBatch (object and deprecated array form), and
// a one-method stub cannot satisfy both. The app calls the array form, which
// leaves an id already in use out of the result (`deleteOrg`), so the object form throws.
export function arrayFormCreateBatch<T>(
  impl: (batch: WorkflowInstanceCreateOptions<T>[]) => Promise<WorkflowInstance[]>,
): Workflow<T>["createBatch"] {
  function createBatch(options: WorkflowBatchCreateOptions<T>): Promise<WorkflowBatchCreateResult>;
  function createBatch(batch: WorkflowInstanceCreateOptions<T>[]): Promise<WorkflowInstance[]>;
  // Not async: `impl`'s promise goes back as it is. Wrapping it in a second
  // promise leaves a rejected one without a handler for a tick, which workerd
  // reports as an unhandled rejection in the tests that inject a failure.
  function createBatch(
    input: WorkflowBatchCreateOptions<T> | WorkflowInstanceCreateOptions<T>[],
  ): Promise<WorkflowBatchCreateResult | WorkflowInstance[]> {
    if (!Array.isArray(input)) {
      return Promise.reject(
        new Error("the app calls the array form of createBatch; this stub models only that"),
      );
    }
    return impl(input);
  }
  return createBatch;
}

// Every worker test gets a completed no-op instance, so a real workflow cannot
// outlive the test and query D1 after its reset.
function stubWorkflow<T>(): Workflow<T> {
  const instance: WorkflowInstance = {
    id: "test-workflow",
    status: async () => ({ status: "complete" }),
    pause: async () => {},
    resume: async () => {},
    terminate: async () => {},
    restart: async () => {},
    sendEvent: async () => {},
    delete: async () => {},
    subscribe: () => {
      throw new Error("no worker test subscribes to workflow events");
    },
  };
  return {
    async create() {
      return instance;
    },
    async get() {
      return instance;
    },
    createBatch: arrayFormCreateBatch(async (batch) => batch.map(() => instance)),
    async deleteBatch(instanceIds) {
      return { deleted: instanceIds.map((id) => ({ id })), errors: [] };
    },
  };
}

// The Vitest plugin builds no asset bundle, so ASSETS is stubbed: without it the SPA fallback
// threw a 500. Polar refuses every call (#412), or the placeholder token would time out on CI;
// a test that wants Polar to answer passes its own BILLING.
const noPolar = () => Promise.reject(new Error("No Polar in worker tests: pass a BILLING stub"));
export const unreachableBilling: BillingProvider = {
  checkouts: { create: noPolar, get: noPolar },
  customerSessions: { create: noPolar },
  subscriptions: { revoke: noPolar, list: noPolar },
  customerPortal: {
    customers: { get: noPolar, listPaymentMethods: noPolar },
    orders: {
      list: noPolar,
      get: noPolar,
      invoice: noPolar,
      generateInvoice: noPolar,
      receipt: noPolar,
    },
  },
};

export const testEnv: Env = {
  ...env,
  BILLING: unreachableBilling,
  ASSETS: stubAssets,
  ORG_DELETE: stubWorkflow(),
  DOMAIN_ACTIVATE: stubWorkflow(),
  LINK_IMPORT: stubWorkflow(),
  NEWSLETTER_SEND: stubWorkflow(),
};

export function overrideEnv(overrides: Partial<Env>): Env {
  return { ...testEnv, ...overrides };
}

const noBacklog = { backlogCount: 0, backlogBytes: 0 };

// Throw from `onSend` to make the send itself fail.
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

// Methods are re-bound to the target because a native Cloudflare binding
// rejects any other receiver.
export function overriding<T extends object>(target: T, overrides: Partial<T>): T {
  return new Proxy(target, {
    get(actual, property) {
      // SAFETY: a `get` trap only ever runs for a key looked up on `actual`,
      // so the trap's key is a key of T.
      const key = property as keyof T;
      if (key in overrides) return overrides[key];
      const value = actual[key];
      return value instanceof Function ? value.bind(actual) : value;
    },
    // A write lands on the view, never on the real binding: Sentry's D1
    // instrumentation assigns a wrapped `prepare` onto env.DB, which would break
    // every later test in the file.
    set(_actual, property, value) {
      return Reflect.set(overrides, property, value);
    },
  });
}

// Records every SQL string the Worker prepares, lowercased: how a test proves a path sent D1 nothing (#489).
export function recordingEnv() {
  const sql: string[] = [];
  const db = overriding(env.DB, {
    prepare(query: string) {
      sql.push(query.toLowerCase());
      return env.DB.prepare(query);
    },
  });
  return { env: overrideEnv({ ...authEnv(), DB: db }), sql };
}

export function clicksStub(): DurableObjectStub<ClickBuffer> {
  return env.CLICK_BUFFER.get(env.CLICK_BUFFER.idFromName("clicks"));
}

export function bufferedClicks(): Promise<ClickMessage[]> {
  return clicksStub().buffered();
}

export async function resetClicks(): Promise<void> {
  await clicksStub().reset();
}

// Turnstile is cleared, not left out: .dev.vars sets TURNSTILE_SECRET_KEY for
// the browser tests (#304), and inheriting it would fail every signup in the
// worker tests with 400. See turnstile.worker.ts for tests that want it on.
export const authEnv = () =>
  // A Web Risk key in a developer's .dev.vars must not reach the tests.
  overrideEnv({
    BETTER_AUTH_SECRET: "test-secret",
    TURNSTILE_SECRET_KEY: undefined,
    TURNSTILE_SITE_KEY: undefined,
    WEB_RISK_API_KEY: undefined,
  });

// Defaults to authEnv(): cookies from signInCookie()/adminCookie() are signed
// against its auth secret.
export async function fetchWorker(request: Request, testEnv: Env = authEnv()): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

// Keeps authEnv()'s auth secret so cookies from signInCookie()/adminCookie() still validate.
export const POLAR_HOBBY_PRODUCT_ID = "prod_hobby";
export const POLAR_PRO_PRODUCT_ID = "prod_pro";
export const POLAR_HOBBY_YEARLY_PRODUCT_ID = "prod_hobby_yearly";
export const POLAR_PRO_YEARLY_PRODUCT_ID = "prod_pro_yearly";
export const POLAR_WEBHOOK_SECRET = "test-webhook-secret";
export const billingEnv = () =>
  overrideEnv({
    BETTER_AUTH_SECRET: "test-secret",
    POLAR_WEBHOOK_SECRET,
    POLAR_HOBBY_PRODUCT_ID,
    POLAR_PRO_PRODUCT_ID,
    POLAR_HOBBY_YEARLY_PRODUCT_ID,
    POLAR_PRO_YEARLY_PRODUCT_ID,
  });

export interface CapturedEmail {
  from?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

// sendEmail() and domainHasMailRecords() post with plain `fetch` (the Resend
// SDK cannot repoint its base URL), so replacing the global is the seam.
// `hold` keeps the send hanging, to prove the worker answered without waiting for Resend.
export function captureEmails({
  mx,
  hold,
  refuse,
}: {
  mx?: "deliverable" | "unroutable";
  hold?: Promise<void>;
  refuse?: string[];
} = {}) {
  const sent: CapturedEmail[] = [];
  let started = false;
  const original = globalThis.fetch;
  const resend = async (init?: RequestInit) => {
    started = true;
    // SAFETY: the only caller of this branch is sendEmail(), which posts a
    // JSON body of exactly these four fields to Resend.
    const email = JSON.parse(bodyText(init) || "{}") as CapturedEmail;
    if (refuse?.includes(email.to)) return new Response("down", { status: 500 });
    sent.push(email);
    if (hold) await hold;
    return Response.json({ id: "sent" });
  };
  const dns = () =>
    Response.json({ Status: 0, Answer: mx === "deliverable" ? [{ data: "10 mx.example." }] : [] });
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/emails")) return resend(init);
    if (mx && url.includes("cloudflare-dns.com")) return dns();
    return original(input, init);
  };
  return { sent, started: () => started, restore: () => (globalThis.fetch = original) };
}

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

export function rollupBackfill(): string[] {
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0042_"));
  // readD1Migrations keeps comments, and 0042's mention the WHERE true the range test replaces.
  return (migration?.queries ?? [])
    .filter((q) => /INSERT INTO click_\w+.*SELECT/s.test(q))
    .map((q) => q.replace(/^\s*--.*$\n?/gm, ""));
}

// Raw `clicks` rows skip insertClicks, which keeps the rollups current (#26); this runs the production backfill.
export async function rebuildClickRollups(): Promise<void> {
  await env.DB.batch(rollupBackfill().map((q) => env.DB.prepare(q)));
}

export const TEST_PASSWORD = "correct-horse-battery";

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

// Unlike adminCookie() (platform admin, pro plan), a non-admin free-plan owner
// of "org-1", so org membership and paid-plan gates apply.
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

// Raw D1 inserts do not fall back to the schema's column defaults when batched
// with rows that specify them, so every column is spelled out here.
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

// A slug only resolves via link_addresses (#38), so seedLink() must create this row.
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

export async function seedLink(destination = "https://example.com") {
  const db = drizzle(env.DB, { schema });
  await db.batch([
    db.insert(schema.orgs).values({ id: "org-1", name: "Test", createdAt: 0 }),
    db.insert(schema.links).values({ ...sampleLink, destination, createdAt: 0 }),
    db.insert(schema.linkAddresses).values({ ...sampleAddress, createdAt: 0 }),
  ]);
  return db;
}

export async function jsonBody<T>(res: Response): Promise<T> {
  // SAFETY: the caller names the shape it is about to assert on, and the
  // assertions are what check it: a route that stops returning that shape
  // fails the test rather than passing quietly.
  return (await res.json()) as T;
}

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

export function captureStorageQueue() {
  const sent: StorageMessage[] = [];
  return { queue: stubQueue<StorageMessage>((m) => sent.push(m)), sent };
}

// Both paths land in `sent` as messages, so a test asserts which keys were resynced, not how.
export function captureStorage() {
  const { queue, sent } = captureStorageQueue();
  const real = env.LINKS;
  const LINKS = overriding(real, {
    put: async (key, value, options) => {
      sent.push({ op: "kv_sync", key });
      return real.put(key, value, options);
    },
    delete: async (key) => {
      sent.push({ op: "kv_sync", key });
      return real.delete(key);
    },
  });
  return { env: { STORAGE_QUEUE: queue, LINKS } satisfies Partial<Env>, sent };
}

export function failingKv(): KVNamespace {
  const fail = async () => {
    throw new Error("injected KV failure");
  };
  return overriding(env.LINKS, { put: fail, delete: fail });
}

// Built with the cloudflare:test helpers so ack/retry/dead-letter assertions match production.
// `attempts` as an array gives each message its own delivery count: a consumer acting on the
// batch's worst count is a bug a uniform number cannot catch.
export function batchOf<Body>(queueName: string, bodies: Body[], attempts: number | number[] = 1) {
  const attemptOf = (i: number) => (Array.isArray(attempts) ? (attempts[i] ?? 1) : attempts);
  const batch = createMessageBatch<Body>(
    queueName,
    bodies.map((body, i) => ({
      id: `m${i}`,
      timestamp: new Date(),
      attempts: attemptOf(i),
      body,
    })),
  );
  const ctx = createExecutionContext();
  return { batch, ctx };
}

// Cloudflare's per-location counters do not reset between test cases, so a test
// says "this budget is gone" with a binding.
export function exhaustedLimit(): RateLimit {
  return { limit: async () => ({ success: false }) };
}

export function openLimit(): RateLimit {
  return { limit: async () => ({ success: true }) };
}

export function recordingLimit(keys: string[]): RateLimit {
  return {
    limit: async (options) => {
      keys.push(String(options?.key));
      return { success: true };
    },
  };
}

export function rateLimits(stubs: Partial<Record<RateLimitBucket, RateLimit>>) {
  const RATE_LIMIT: RateLimit = {
    limit: async (options) => {
      const stub = lookup(stubs, options.key.split(":")[0] ?? "");
      return stub ? stub.limit(options) : { success: true };
    },
  };
  return { RATE_LIMIT } satisfies Partial<Env>;
}

export async function seedFillerLinks(
  db: ReturnType<typeof testDb>,
  orgId: string,
  count: number,
  idPrefix: string,
) {
  const rows = Array.from({ length: count }, (_, i) => ({
    link: rawLinkRow({
      id: `${idPrefix}-link-${i}`,
      orgId,
      slug: `${idPrefix}-${i}`,
      destination: "https://example.com",
      createdAt: 0,
    }),
    address: rawAddressRow({
      id: `${idPrefix}-addr-${i}`,
      linkId: `${idPrefix}-link-${i}`,
      orgId,
      slug: `${idPrefix}-${i}`,
      kind: "primary",
      createdAt: 0,
    }),
  }));
  const writes = [
    ...rows.map((r) => db.insert(schema.links).values(r.link)),
    ...rows.map((r) => db.insert(schema.linkAddresses).values(r.address)),
  ];
  // SAFETY: rows is never empty here, so writes has at least the one entry
  // drizzle batch() insists on in its first slot.
  await db.batch(writes as [(typeof writes)[number], ...(typeof writes)[number][]]);
}

export interface Posted {
  from: string;
  to: string[];
  reply_to?: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

// `status` answers each call by its index, so a test can fail one batch only.
// Like Resend, a key already delivered sends nothing again: the same body gets
// the first answer, another body a 409.
export function captureBatches(status: (call: number) => number = () => 200) {
  const batches: { key: string | null; emails: Posted[] }[] = [];
  const delivered = new Map<string, string>();
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (!url.endsWith("/emails/batch")) return original(input, init);
    const headers = new Headers(init?.headers);
    // SAFETY: the only sender of this request is deliverBatch(), which posts
    // an array of exactly these fields.
    const emails = JSON.parse(bodyText(init) || "[]") as Posted[];
    const answer = status(calls);
    calls += 1;
    const key = headers.get("idempotency-key");
    const body = bodyText(init);
    const seen = key === null ? undefined : delivered.get(key);
    if (answer === 409 || (seen !== undefined && seen !== body)) {
      return Response.json({ name: "invalid_idempotent_request" }, { status: 409 });
    }
    if (answer !== 200) return new Response("down", { status: answer });
    const ok = Response.json({ data: emails.map((_, i) => ({ id: `m${i}` })) });
    if (seen !== undefined) return ok;
    if (key !== null) delivered.set(key, body);
    batches.push({ key, emails });
    return ok;
  };
  return {
    batches,
    calls: () => calls,
    restore: () => (globalThis.fetch = original),
  };
}

export async function fillFreePlanLinks(): Promise<void> {
  const statements = [];
  for (let i = 0; i < 30; i++) {
    statements.push(
      env.DB.prepare(
        `insert into links (id, org_id, slug, destination, created_at)
         values (?, 'org-1', ?, 'https://example.com', 0)`,
      ).bind(`full-${i}`, `full${i}`),
      env.DB.prepare(
        `insert into link_addresses (id, link_id, org_id, slug, kind, created_at)
         values (?, ?, 'org-1', ?, 'primary', 0)`,
      ).bind(`addr-${i}`, `full-${i}`, `full${i}`),
    );
  }
  await env.DB.batch(statements);
}

export type ApiInit = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

export function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : input.toString();
}

export function bodyText(init?: RequestInit): string {
  const body = init?.body;
  if (body instanceof URLSearchParams) return body.toString();
  const text = v.safeParse(v.string(), body);
  return text.success ? text.output : "";
}
