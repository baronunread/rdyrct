import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { hashPassword } from "../../src/worker/password";
import { applyTestMigrations, authEnv, signInCookie, TEST_PASSWORD } from "./support";

/**
 * No Polar settings: nothing is sold, so nothing is capped and billing is
 * not there. Its own file because plan.ts holds the billing switch as module
 * state, set on each request from that request's env.
 */
beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ...authEnv(), POLAR_ACCESS_TOKEN: undefined, POLAR_WEBHOOK_SECRET: undefined },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

it("has no caps and no billing without Polar", async () => {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('u1', 'Test', 'free@example.com', 1, 0, 'free', 0, 0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('a1', 'u1', 'credential', 'u1', ?, 0, 0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
  ]);
  const cookie = await signInCookie("free@example.com", TEST_PASSWORD);
  const headers = { cookie, "content-type": "application/json" };

  const me = await call("/api/user", { headers });
  // SAFETY: /api/user answers { user } with the plan string, and the test fails on any other shape.
  expect(((await me.json()) as { user: { plan: string } }).user.plan).toBe("unlimited");

  // A free user owns one org, and sign-in already made it. Two more is Pro-only.
  for (const name of ["Second", "Third"]) {
    const res = await call("/api/orgs", {
      method: "POST",
      headers,
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(201);
  }

  expect((await call("/api/billing/portal", { method: "POST", headers })).status).toBe(404);
  expect((await call("/api/webhooks/polar", { method: "POST", body: "{}" })).status).toBe(404);
});
