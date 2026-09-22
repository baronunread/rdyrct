import { expect, test } from "@playwright/test";

// The landing-page-cta-test experiment (notebook v4JI): `control` is today's
// copy-first hero, `test` leads with the working demo instead. Consent has
// to be granted before the app mounts, via addInitScript rather than
// clicking "Accept" after load, because the hero only checks PostHog for a
// variant once, on mount (see useHeroCtaVariant in landing.tsx) — accepting
// mid-visit would arrive too late to change what's already rendered.
const CONSENT_KEY = "rdyrct:consent:v2";
const FLAGS_GLOB = "**/*.i.posthog.com/flags/**";

test.describe("landing hero CTA experiment", () => {
  test("without consent, the hero stays on the control layout", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Short links and QR codes that show which channel earned the click.",
    );
    await expect(page.getByRole("link", { name: "See the analytics" })).toBeVisible();
  });

  test("bucketed into the test variant, the hero leads with the demo", async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "accepted"), CONSENT_KEY);
    // Registered in this order so the more specific /flags/ route (added
    // last) wins: Playwright tries the most recently registered matching
    // route first. Everything else PostHog tries to reach stays blocked,
    // same as funnel.pw.ts; only the flags answer needs to be real.
    await page.route("**/*.i.posthog.com/**", (route) => route.abort());
    await page.route(FLAGS_GLOB, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ featureFlags: { "landing-page-cta-test": "test" } }),
      }),
    );

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Shorten a link. See who clicks it.",
    );
    await expect(page.getByRole("link", { name: "See the analytics" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Skip the demo, get started free" })).toBeVisible();
    await expect(page.getByLabel("Shorten a link, no account needed")).toBeVisible();
  });
});
