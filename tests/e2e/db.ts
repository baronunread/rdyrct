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

export async function setPlan(page: Page, email: string, plan: "hobby" | "pro" = "hobby") {
  await rawSql(page, "UPDATE user SET plan = ? WHERE email = ?", [plan, email]);
}
