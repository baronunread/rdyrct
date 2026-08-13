import { beforeEach, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { applyTestMigrations, captureEmails, fetchWorker, overrideEnv } from "./support";
import { spendToken } from "../../src/worker/cap";

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

it("refuses a challenge when the secret is too short to use", async () => {
  // capjs-core refuses a secret under 16 bytes by throwing, and it throws
  // when a challenge is issued rather than at startup. Which way that falls
  // is the point: a secret that is set but unusable must take the Cap route
  // down, never fall through to the disabled path and leave signup looking
  // configured and completely unprotected. `capEnabled` only asks whether
  // the secret is set, so "set but unusable" is exactly the gap between the
  // two, and it is answered by us rather than by a library stack trace
  // reaching the top of the Worker.
  const res = await fetchWorker(
    new Request("http://localhost/api/cap/signup/challenge", { method: "POST" }),
    overrideEnv({ BETTER_AUTH_SECRET: "test-secret", CAP_SECRET: "tooshort" }),
  );

  expect(res.status).toBe(503);
});

it("refuses to spend a token when the secret is too short to use", async () => {
  // The other half: the check that decides whether a signup is let through
  // must not answer "ok" on a secret no challenge could have been signed
  // with. Called directly rather than through signup, because getAuth()
  // memoizes one auth instance per isolate (see above) and the first test in
  // this file already built one with Cap disabled.
  await expect(
    spendToken(overrideEnv({ CAP_SECRET: "tooshort" }), "signup", "1.deadbeef"),
  ).rejects.toThrow();
});
