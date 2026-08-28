import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows } from "./db";

/**
 * Destination scoring, through the app the way a person uses it (#68).
 *
 * The worker tests stub the resolver and assert the pipeline. This one runs
 * against the real resolver and asserts the two things only a browser can
 * show: that creating a link is not delayed or blocked by the scoring, and
 * that the verdict lands on the row afterwards.
 *
 * It scores a genuinely bad destination using the addresses Cloudflare
 * publishes for exactly this purpose, so the assertion does not depend on
 * some real site's reputation staying bad.
 */

const password = "test-password-123";
const BLOCKED_DESTINATION = "https://malware.testcategory.com/";

type RiskRow = { risk_score: number | null; risk_reasons: string | null };

test("a new link is created immediately and scored afterwards (#68)", async ({ page }) => {
  const email = `risk-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);

  const destination = page.getByPlaceholder("Paste a URL, or just start typing").first();
  await expect(destination).toBeVisible();
  await destination.fill(BLOCKED_DESTINATION);

  const started = Date.now();
  await page.getByRole("button", { name: "Create link" }).click();

  // The link exists straight away: scoring never sits in the request path.
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(10_000);

  // Nothing about the score is shown to the person who made it: this is
  // admin-only signal (#67), and telling a creator which destinations pass
  // is a map for working around the check. The API-shape version of this
  // assertion, which is the one with teeth, is in link-risk.worker.ts.
  await expect(page.getByText(/dns_blocklist|risk score/i)).toHaveCount(0);

  // The verdict lands on the row shortly after, from the real resolver.
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
