import { expect, type Page } from "@playwright/test";
import { explorerUrl } from "./environment";
import { subscriptionGrantsAccess } from "../../src/worker/entitlement";
import type { JsonValue } from "../../src/shared/types";

interface ExplorerRaw {
  result: {
    results: { columns: string[]; rows: JsonValue[][] };
    meta: { changes: number };
  }[];
}

export type SqlParam = string | number | boolean | null;

// The Explorer rejects any non-string parameter with only "Invalid input". SQLite column
// affinity converts a numeric string back on the way in.
function asExplorerParam(value: SqlParam): string | null {
  return value === null ? null : String(value);
}

export async function rawSql(
  page: Page,
  sql: string,
  params: SqlParam[] = [],
): Promise<ExplorerRaw> {
  const databases = await page.request.get(`${explorerUrl}/d1/database`);
  expect(databases.ok()).toBe(true);
  const body = await databases.json();
  const databaseId = body.result.find((database: { name: string }) => database.name === "DB")?.uuid;
  expect(databaseId).toBeTruthy();

  const response = await page.request.post(`${explorerUrl}/d1/database/${databaseId}/raw`, {
    data: { sql, params: params.map(asExplorerParam) },
  });
  // The body carries the actual complaint (a failed constraint, a rejected
  // parameter). Without it a failure here is an opaque "expected true".
  expect(response.ok(), `${sql}\n${await response.text()}`).toBe(true);
  return response.json();
}

// The Explorer's /raw answer is column-oriented; indexing a row by column name yields
// undefined instead of an error, so callers get objects.
export async function queryRows<T>(page: Page, sql: string, params: SqlParam[] = []): Promise<T[]> {
  const { columns, rows } = (await rawSql(page, sql, params)).result[0].results;
  // SAFETY: the caller names the columns its own SELECT asks for. A column it
  // did not select reads as undefined and fails whichever assertion wanted it,
  // here rather than somewhere downstream.
  return rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])) as T);
}

async function expectOneRowChanged(
  page: Page,
  sql: string,
  params: SqlParam[],
  what: string,
): Promise<void> {
  const result = await rawSql(page, sql, params);
  // An unmatched email leaves the UPDATE a silent no-op: fail here instead of
  // at some unrelated paid-plan gate downstream.
  expect(result.result[0].meta.changes, what).toBe(1);
}

// Like a Polar webhook: the subscription columns carry the facts and `plan` is derived (#81).
export async function setPlan(
  page: Page,
  email: string,
  plan: "hobby" | "pro" = "hobby",
  opts: { status?: string; interval?: "month" | "year" } = {},
) {
  const { status = "active", interval } = opts;
  // The Explorer's raw SQL endpoint rejects a null parameter, so an unset
  // cycle is the NULL keyword, not a bound value.
  const intervalSql = interval ? "?" : "NULL";
  await expectOneRowChanged(
    page,
    `UPDATE user
     SET subscription_plan = ?, subscription_status = ?,
         polar_subscription_id = 'sub_e2e_' || id, polar_customer_id = 'cus_e2e_' || id,
         plan = ?, polar_subscription_interval = ${intervalSql}
     WHERE email = ?`,
    // The same rule the Worker applies, from the same table: `trialing` and
    // `past_due` also entitle, so deciding on `active` alone would build a
    // fixture no webhook can produce.
    [
      plan,
      status,
      subscriptionGrantsAccess(status) ? plan : "free",
      ...(interval ? [interval] : []),
      email,
    ],
    `no user with email ${email}`,
  );
}

// Does not sign in as the user: a second signup in one browser context would first sign
// the first user out.
export async function seedSubscriber(page: Page, email: string, plan: "hobby" | "pro" = "pro") {
  await expectOneRowChanged(
    page,
    `INSERT INTO user (id, name, email, email_verified, plan, subscription_plan,
       subscription_status, polar_subscription_id, polar_customer_id, created_at, updated_at)
     VALUES (?, 'Paying Customer', ?, 1, ?, ?, 'active',
       ?, ?, unixepoch() * 1000, unixepoch() * 1000)`,
    [`e2e-sub-${Date.now()}`, email, plan, plan, `sub_e2e_${Date.now()}`, `cus_e2e_${Date.now()}`],
    `could not insert ${email}`,
  );
}

// SQL, so the test does not depend on SUPERADMIN_EMAIL, which differs between machines.
export async function makePlatformAdmin(page: Page, email: string) {
  await expectOneRowChanged(
    page,
    "UPDATE user SET is_admin = 1 WHERE email = ?",
    [email],
    `no user with email ${email}`,
  );
}

export async function setOrgsOverride(page: Page, email: string, orgs: number) {
  await expectOneRowChanged(
    page,
    `INSERT INTO limit_overrides (user_id, limit_key, value, note, set_at)
     SELECT id, 'orgs', ?, 'e2e fixture', unixepoch() * 1000 FROM user WHERE email = ?
     ON CONFLICT (user_id, limit_key) DO UPDATE SET value = excluded.value`,
    [orgs, email],
    `no user with email ${email}`,
  );
}

export async function compUser(
  page: Page,
  email: string,
  plan: "hobby" | "pro" = "pro",
  reason = "e2e fixture",
) {
  await expectOneRowChanged(
    page,
    `UPDATE user
     SET comp_plan = ?, comp_reason = ?, comp_granted_at = unixepoch() * 1000, plan = ?
     WHERE email = ?`,
    [plan, reason, plan, email],
    `no user with email ${email}`,
  );
}

// The redirect hot path answers from KV alone, so this reads the verdict the Worker acts on.
export async function kvValue(page: Page, key: string): Promise<JsonValue | null> {
  const namespaces = await page.request.get(`${explorerUrl}/storage/kv/namespaces`);
  expect(namespaces.ok()).toBe(true);
  const listed = await namespaces.json();
  const id = listed.result.find((n: { title: string }) => n.title.includes("LINKS"))?.id;
  expect(id).toBeTruthy();
  const value = await page.request.get(
    `${explorerUrl}/storage/kv/namespaces/${id}/values/${encodeURIComponent(key)}`,
  );
  if (value.status() === 404) return null;
  expect(value.ok()).toBe(true);
  // SAFETY: every value this repo writes to LINKS is JSON it produced; the
  // caller names the shape it asserts on.
  return JSON.parse(await value.text()) as JsonValue;
}
