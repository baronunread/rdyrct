/**
 * An email invite is bound to the address it was sent to, and an account
 * only owns an address once it has proved it.
 *
 * Without that, an account that signed up as somebody else's address and
 * never verified it could accept that person's invite, at its role. A link
 * invite (no address) stays a bearer link.
 *
 * A deployment with no email provider can prove no address at all, so there
 * the token is all the proof there is: the admin handed it to that person.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { hashPassword } from "../../src/worker/password";
import {
  TEST_PASSWORD,
  applyTestMigrations,
  authEnv,
  fetchWorker,
  overrideEnv,
  signInCookie,
} from "./support";

const EMAIL = "ceo@bigcorp.com";
let cookie: string;

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('owner-1', 'Owner', 'owner@example.com', 1, 0, 'pro', 0, 0)",
    ),
    env.DB.prepare("insert into orgs (id, name, created_at) values ('org-1', 'Victim', 0)"),
    env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'owner-1', 'owner', 0)",
    ),
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('claimer', 'Claimer', ?, 1, 0, 'free', 0, 0)",
    ).bind(EMAIL),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('acct-claimer', 'claimer', 'credential', 'claimer', ?, 0, 0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
  ]);
  // Signed in while verified (sign-in refuses an unverified address when
  // email is on), then set to the state each test wants.
  cookie = await signInCookie(EMAIL, TEST_PASSWORD);
});
afterEach(reset);

async function setVerified(verified: boolean): Promise<void> {
  await env.DB.prepare("update user set email_verified = ? where id = 'claimer'")
    .bind(verified ? 1 : 0)
    .run();
}

async function makeInvite(email: string | null): Promise<string> {
  const token = `tok-${email ?? "link"}`;
  await env.DB.prepare(
    "insert into invites (token, org_id, role, email, created_by, created_at, expires_at) values (?, 'org-1', 'admin', ?, 'owner-1', 0, ?)",
  )
    .bind(token, email, Date.now() + 86_400_000)
    .run();
  return token;
}

async function accept(token: string, testEnv = authEnv()): Promise<number> {
  const res = await fetchWorker(
    new Request(`http://localhost/api/invites/${token}/accept`, {
      method: "POST",
      headers: { cookie },
    }),
    testEnv,
  );
  return res.status;
}

const roleOf = async (): Promise<string | null> =>
  (
    await env.DB.prepare(
      "select role from org_members where org_id = 'org-1' and user_id = 'claimer'",
    ).first<{ role: string }>()
  )?.role ?? null;

describe("email invites with email sending on", () => {
  it("refuses an account that has not verified the invited address", async () => {
    await setVerified(false);
    const token = await makeInvite(EMAIL);
    expect(await accept(token)).toBe(403);
    expect(await roleOf()).toBeNull();
  });

  it("accepts the verified owner of the invited address, at the invite's role", async () => {
    const token = await makeInvite(EMAIL);
    expect(await accept(token)).toBe(200);
    expect(await roleOf()).toBe("admin");
  });

  it("still lets an unverified account take a link invite", async () => {
    await setVerified(false);
    const token = await makeInvite(null);
    expect(await accept(token)).toBe(200);
    expect(await roleOf()).toBe("admin");
  });
});

describe("email invites with no email provider", () => {
  const noEmail = () => overrideEnv({ ...authEnv(), RESEND_API_KEY: undefined });

  it("accepts the invited address unverified, since nothing can verify it", async () => {
    await setVerified(false);
    const token = await makeInvite(EMAIL);
    expect(await accept(token, noEmail())).toBe(200);
    expect(await roleOf()).toBe("admin");
  });

  it("still refuses a different address", async () => {
    await setVerified(false);
    const token = await makeInvite("someone@else.com");
    expect(await accept(token, noEmail())).toBe(403);
    expect(await roleOf()).toBeNull();
  });
});
