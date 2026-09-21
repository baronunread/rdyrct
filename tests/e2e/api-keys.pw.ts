import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

const E2E_PASSWORD = "test-password-123";

test("mint a key from its own nav tab, use it, then revoke it", async ({ page, request }) => {
  await signUpAndVerify(page, `apikeys-${Date.now()}@gmail.com`, E2E_PASSWORD);

  await page.getByRole("link", { name: "API & MCP" }).click();
  await expect(page.getByRole("heading", { name: "API & MCP" })).toBeVisible();

  await page.getByPlaceholder("Key name, e.g. Claude").fill("Playwright key");
  await page.getByRole("button", { name: "Create key" }).click();

  await expect(page.getByText("Playwright key is ready")).toBeVisible();
  const keyText = await page.locator("code", { hasText: "rdyrct_live_" }).textContent();
  const key = keyText?.trim();
  if (!key) throw new Error("Minted key was never shown");
  expect(key).toMatch(/^rdyrct_live_/);

  // The banner and the page both offer the ready-to-paste connector setup.
  await expect(page.getByRole("button", { name: "Copy MCP setup" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("row", { name: /Playwright key/ })).toBeVisible();

  const mcpHeaders = (bearer: string) => ({
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  const listRes = await request.post("/api/mcp", {
    headers: mcpHeaders(key),
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(listRes.status()).toBe(200);

  await page.getByRole("button", { name: "Revoke Playwright key" }).click();
  await page.getByRole("button", { name: "Revoke key" }).click();
  await expect(page.getByText("No API keys yet")).toBeVisible();

  const revokedRes = await request.post("/api/mcp", {
    headers: mcpHeaders(key),
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(revokedRes.status()).toBe(401);
});
