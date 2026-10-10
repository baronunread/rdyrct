import { beforeEach, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { applyTestMigrations, captureEmails, fetchWorker, overrideEnv } from "./support";

/**
 * No RESEND_API_KEY: nothing can send a code, so sign-up must not ask for one.
 * Its own file for the same reason as cap-disabled: getAuth() memoizes one
 * auth instance per isolate, built from the env of the first request.
 */
beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

it("signs up without verification and sends no email", async () => {
  const mail = captureEmails({ mx: "deliverable" });
  const env = overrideEnv({
    BETTER_AUTH_SECRET: "test-secret",
    TURNSTILE_SECRET_KEY: undefined,
    RESEND_API_KEY: undefined,
  });

  const res = await fetchWorker(
    new Request("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "noemail@example.com",
        password: "a-good-password-1",
        name: "probe",
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain("session");

  const config = await fetchWorker(new Request("http://localhost/api/config"), env);
  expect(await config.json()).toMatchObject({ emailEnabled: false });
  expect(mail.sent).toEqual([]);
  mail.restore();
});
