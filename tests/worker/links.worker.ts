import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { hashPassword } from "../../src/worker/password";
import { applyTestMigrations, authEnv } from "./support";

// A real (non-admin) free-plan user who owns "org-1" — unlike adminCookie(),
// which is both a platform admin and on the pro plan, so it bypasses both
// the org-membership check and the QR paid-plan gate this file exercises.
async function freeOwnerCookie(): Promise<string> {
  const password = "correct-horse-battery";
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('free-1', 'Free', 'free@example.com', 1, 0, 'free', 0, 0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-free-1', 'free-1', 'credential', 'free-1', ?, 0, 0)",
    ).bind(await hashPassword(password)),
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Test', 0)"),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'free-1', 'owner', 0)",
    ),
  ]);
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "free@example.com", password }),
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function postLink(cookie: string, body: Record<string, unknown>): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("http://localhost/api/orgs/org-1/links", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    authEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST /orgs/:orgId/links: QR gate on the free plan", () => {
  beforeEach(applyTestMigrations);
  afterEach(reset);

  it("succeeds when qrLogoSize is null, same as the link editor always sends it", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postLink(cookie, { destination: "https://example.com", qrLogoSize: null });
    expect(res.status).toBe(201);
  });

  it("still 402s when a real QR override is set", async () => {
    const cookie = await freeOwnerCookie();
    const res = await postLink(cookie, {
      destination: "https://example.com",
      qrLogoSize: null,
      qrStyle: "dots",
    });
    expect(res.status).toBe(402);
  });
});
