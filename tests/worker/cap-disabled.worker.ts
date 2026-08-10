import { beforeEach, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { applyTestMigrations, captureEmails, fetchWorker, overrideEnv } from "./support";

/**
 * Cap with no CAP_SECRET set (#98): the gate is off and signup works exactly
 * as it did before, which is what keeps local dev, CI and the e2e run from
 * needing a secret.
 *
 * Its own file because getAuth() memoizes one auth instance per isolate, and
 * that instance closes over the env that built it. A test sharing a file with
 * the enabled cases would inherit the enabled hook no matter which env it
 * passed. Bindings are stable in production, so nothing here is a product
 * defect: it is the cost of that cache, paid in test layout.
 */
beforeEach(async () => {
  reset();
  await applyTestMigrations();
  captureEmails({ mx: "deliverable" });
});

it("lets signup through untouched when no secret is configured", async () => {
  const res = await fetchWorker(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "nosecret@example.com",
        password: "a-good-password-1",
        name: "probe",
      }),
    }),
    overrideEnv({ BETTER_AUTH_SECRET: "test-secret", CAP_SECRET: undefined }),
  );
  expect(res.status).toBe(200);
});
