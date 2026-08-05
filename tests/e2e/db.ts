import { expect, type Page } from "@playwright/test";
import { explorerUrl } from "./environment";

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

export async function setPlan(page: Page, email: string, plan: "hobby" | "pro" = "hobby") {
  const result = (await rawSql(page, "UPDATE user SET plan = ? WHERE email = ?", [
    plan,
    email,
  ])) as { result: { meta: { changes: number } }[] };
  // An unmatched email leaves the UPDATE a silent no-op: fail here instead of
  // at some unrelated paid-plan gate downstream.
  expect(result.result[0].meta.changes).toBe(1);
}
