import { expect, type Page } from "@playwright/test";
import { explorerUrl } from "./environment";
import { subscriptionGrantsAccess } from "../../src/worker/entitlement";

/** Runs raw SQL against the local D1 database via the dev Explorer API. */
export async function rawSql(page: Page, sql: string, params: unknown[] = []): Promise<unknown> {
  const databases = await page.request.get(`${explorerUrl}/d1/database`);
  expect(databases.ok()).toBe(true);
  const body = await databases.json();
  const databaseId = body.result.find((database: { name: string }) => database.name === "DB")?.uuid;
  expect(databaseId).toBeTruthy();

  const response = await page.request.post(`${explorerUrl}/d1/database/${databaseId}/raw`, {
    data: { sql, params },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

/**
 * Runs a SELECT and returns its rows as objects.
 *
 * The Explorer's /raw endpoint answers column-oriented
 * (`{ columns: [...], rows: [[...]] }`), which is easy to misread as a list
 * of row objects: indexing one by column name yields `undefined` rather than
 * an error, so the mistake surfaces later as a confusing assertion failure.
 * Callers get objects instead.
 */
export async function queryRows<T extends Record<string, unknown>>(
  page: Page,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const body = (await rawSql(page, sql, params)) as {
    result: { results: { columns: string[]; rows: unknown[][] } }[];
  };
  const { columns, rows } = body.result[0].results;
  return rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])) as T);
}

async function expectOneRowChanged(
  page: Page,
  sql: string,
  params: unknown[],
  what: string,
): Promise<void> {
  const result = (await rawSql(page, sql, params)) as {
    result: { meta: { changes: number } }[];
  };
  // An unmatched email leaves the UPDATE a silent no-op: fail here instead of
  // at some unrelated paid-plan gate downstream.
  expect(result.result[0].meta.changes, what).toBe(1);
}

/**
 * Gives a user a paying subscription, the way a Polar webhook would: the
 * subscription columns carry the facts and `plan` is derived from them (#81).
 * Writing `plan` on its own would produce a row no real flow can create.
 */
export async function setPlan(
  page: Page,
  email: string,
  plan: "hobby" | "pro" = "hobby",
  opts: { status?: string } = {},
) {
  const { status = "active" } = opts;
  await expectOneRowChanged(
    page,
    `UPDATE user
     SET subscription_plan = ?, subscription_status = ?,
         polar_subscription_id = 'sub_e2e_' || id, polar_customer_id = 'cus_e2e_' || id,
         plan = ?
     WHERE email = ?`,
    // The same rule the Worker applies, from the same table: `trialing` and
    // `past_due` also entitle, so deciding on `active` alone would build a
    // fixture no webhook can produce.
    [plan, status, subscriptionGrantsAccess(status) ? plan : "free", email],
    `no user with email ${email}`,
  );
}

/**
 * Inserts a user who already pays, without going through signup: the test
 * that needs one never signs in as them, and a second signup in the same
 * browser context would have to sign the first user out first.
 */
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

/** Promotes a signed-up user to platform admin, for tests that need the
 * admin area. Doing it in SQL keeps the test off the SUPERADMIN_EMAIL
 * secret, which differs between machines. */
export async function makePlatformAdmin(page: Page, email: string) {
  await expectOneRowChanged(
    page,
    "UPDATE user SET is_admin = 1 WHERE email = ?",
    [email],
    `no user with email ${email}`,
  );
}

/** Gives a user paid access the way an admin comp does: no subscription
 * behind it, and no revenue. */
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
