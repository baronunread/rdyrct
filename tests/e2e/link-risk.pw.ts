import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows } from "./db";
import { openNewLinkForm } from "./orgs";

// Cloudflare publishes this destination for testing, so the assertion does not
// depend on a real site's reputation staying bad.

const password = "test-password-123";
const BLOCKED_DESTINATION = "https://malware.testcategory.com/";

type RiskRow = { risk_score: number | null; risk_reasons: string | null };

test("a new link is created immediately and scored afterwards (#68)", async ({ page }) => {
  const email = `risk-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  const form = await openNewLinkForm(page);
  await form.getByRole("textbox", { name: "Destination", exact: true }).fill(BLOCKED_DESTINATION);

  const started = Date.now();
  await form.getByRole("button", { name: "Create link" }).click();

  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(10_000);

  // The score is admin-only (#67): showing it would tell a creator which
  // destinations pass. The API-shape check is in link-risk.worker.ts.
  await expect(page.getByText(/dns_blocklist|risk score/i)).toHaveCount(0);

  await expect
    .poll(
      async () => {
        const rows = await queryRows<RiskRow>(
          page,
          "select risk_score, risk_reasons from links where destination = ?",
          [BLOCKED_DESTINATION],
        );
        return rows[0]?.risk_score ?? null;
      },
      { timeout: 20_000, message: "destination was never scored" },
    )
    .toBe(100);

  const rows = await queryRows<RiskRow>(
    page,
    "select risk_score, risk_reasons from links where destination = ?",
    [BLOCKED_DESTINATION],
  );
  expect(JSON.parse(rows[0].risk_reasons ?? "[]")).toEqual(["dns_blocklist"]);
});
