import { test } from "@playwright/test";
import { signUpWithLiveLink } from "./orgs";

/**
 * In production a new link used to 404 until the storage queue's batch window
 * passed, and KV cached the miss. No polling: the first request must redirect.
 */

test("a new link redirects on its very first click", async ({ page }) => {
  await signUpWithLiveLink(page, "live-link");
});
