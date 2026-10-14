import { beforeEach, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { applyTestMigrations, captureEmails, fetchWorker, overrideEnv } from "./support";

/**
 * With no TURNSTILE_SECRET_KEY the gate is off and signup works as it did
 * before, which keeps local dev, self-hosting and CI from needing a key.
 *
 * Its own file because getAuth() memoizes one auth instance per isolate, and
 * that instance closes over the env that built it.
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
    overrideEnv({ BETTER_AUTH_SECRET: "test-secret", TURNSTILE_SECRET_KEY: undefined }),
  );
  expect(res.status).toBe(200);
});
