import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, authEnv, fetchWorker, signInCookie, TEST_PASSWORD } from "./support";
import { hashPassword } from "../../src/worker/password";

/**
 * Every account owns an organization from its first session.
 *
 * The empty state used to make it, which meant the app had a state where a
 * signed-in person owned nothing and every org-scoped page had to know about
 * it. Now "no organization" is a state somebody chose by deleting their last
 * one, and the screen for it is a plain create form rather than onboarding.
 */

async function seedUser(id: string, email: string, name = "Person") {
  await env.DB.batch([
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values (?, ?, ?, 1, 0, 'free', 0, 0)",
    ).bind(id, name, email),
    env.DB.prepare(
      "insert into account (id, account_id, issuer, provider_id, user_id, password, created_at, updated_at) values (?, ?, 'local:credential', 'credential', ?, ?, 0, 0)",
    ).bind(`acct-${id}`, id, id, await hashPassword(TEST_PASSWORD)),
  ]);
}

async function ownedOrgs(userId: string) {
  const { results } = await env.DB.prepare(
    `select orgs.id as id, orgs.name as name, orgs.deleting_at as deletingAt
       from org_members join orgs on orgs.id = org_members.org_id
      where org_members.user_id = ? and org_members.role = 'owner'`,
  )
    .bind(userId)
    .all<{ id: string; name: string; deletingAt: number | null }>();
  return results;
}

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

describe("the first session", () => {
  it("gives the account an organization named from its email domain", async () => {
    await seedUser("u-work", "person@acme.com");
    await signInCookie("person@acme.com", TEST_PASSWORD);

    const orgs = await ownedOrgs("u-work");
    expect(orgs).toHaveLength(1);
    expect(orgs[0].name).toBe("Acme");
  });

  it("falls back to the person for a consumer address", async () => {
    await seedUser("u-home", "someone@gmail.com", "Ada");
    await signInCookie("someone@gmail.com", TEST_PASSWORD);

    expect((await ownedOrgs("u-home"))[0].name).toBe("Ada's links");
  });

  it("does not add a second one on every sign-in", async () => {
    await seedUser("u-again", "again@acme.com");
    await signInCookie("again@acme.com", TEST_PASSWORD);
    await signInCookie("again@acme.com", TEST_PASSWORD);
    await signInCookie("again@acme.com", TEST_PASSWORD);

    expect(await ownedOrgs("u-again")).toHaveLength(1);
  });

  it("gives a Pro account one organization, not one per concurrent sign-in", async () => {
    // The read that skips this is a fast path, not the guard. Two sessions
    // created at once both see no organization, and Pro is allowed three, so
    // both had room and the account arrived with two: the switcher offered a
    // choice nobody made, over an organization with nothing in it.
    await seedUser("u-pro", "pro@acme.com");
    await env.DB.prepare("update user set plan = 'pro' where id = 'u-pro'").run();

    await Promise.all([
      signInCookie("pro@acme.com", TEST_PASSWORD),
      signInCookie("pro@acme.com", TEST_PASSWORD),
      signInCookie("pro@acme.com", TEST_PASSWORD),
    ]);

    expect(await ownedOrgs("u-pro")).toHaveLength(1);
  });

  it("leaves an account that already owns one alone", async () => {
    await seedUser("u-owner", "owner@acme.com");
    await env.DB.batch([
      env.DB.prepare("insert into orgs (id, name, created_at) values ('kept', 'Kept', 0)"),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('kept', 'u-owner', 'owner', 0)",
      ),
    ]);
    await signInCookie("owner@acme.com", TEST_PASSWORD);

    const orgs = await ownedOrgs("u-owner");
    expect(orgs).toHaveLength(1);
    expect(orgs[0].id).toBe("kept");
  });
});

describe("deleting the account", () => {
  async function deleteAccount(cookie: string) {
    return fetchWorker(
      new Request("http://localhost/api/auth/delete-user", {
        method: "POST",
        // better-auth refuses a state-changing call with no Origin.
        headers: { "content-type": "application/json", origin: "http://localhost", cookie },
        body: JSON.stringify({ password: TEST_PASSWORD }),
      }),
      authEnv(),
    );
  }

  it("takes the organizations nobody else is in with it", async () => {
    // The reason this test exists: with an organization handed to every
    // account, the old "you still own organizations" refusal would have made
    // every account undeletable, including one that had done nothing.
    await seedUser("u-solo", "solo@acme.com");
    const cookie = await signInCookie("solo@acme.com", TEST_PASSWORD);
    expect(await ownedOrgs("u-solo")).toHaveLength(1);

    const res = await deleteAccount(cookie);
    expect(res.status).toBe(200);

    // Teardown runs as a workflow, so what this asserts is that it started:
    // the org is flagged for deletion rather than left untouched.
    const { results } = await env.DB.prepare("select deleting_at from orgs").all<{
      deleting_at: number | null;
    }>();
    // Length first: `every` is true of no rows, so an org deleted outright
    // rather than flagged would pass this silently.
    expect(results).toHaveLength(1);
    expect(results[0]!.deleting_at).not.toBeNull();
  });

  it("takes an owned organization that has other members in it too", async () => {
    // It used to refuse this, which left the account undeletable until the
    // owner emptied the org by hand. An org has no plan of its own (orgPlan
    // reads its owner's), so one kept alive without an owner has no plan, no
    // billing and nobody who can delete it. Settings names every org in the
    // confirmation before it asks (#119).
    await seedUser("u-lead", "lead@acme.com");
    await seedUser("u-mate", "mate@acme.com");
    const cookie = await signInCookie("lead@acme.com", TEST_PASSWORD);
    const [org] = await ownedOrgs("u-lead");
    await env.DB.prepare(
      "insert into org_members (org_id, user_id, role, created_at) values (?, 'u-mate', 'member', 0)",
    )
      .bind(org.id)
      .run();

    const res = await deleteAccount(cookie);
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("select deleting_at from orgs where id = ?")
      .bind(org.id)
      .first<{ deleting_at: number | null }>();
    expect(row!.deleting_at).not.toBeNull();
  });
});
