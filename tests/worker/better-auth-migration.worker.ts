import { afterEach, beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { hashPassword } from "../../src/worker/password";
import { signInCookie, TEST_PASSWORD } from "./support";

const issuerMigration = "0028_better_auth_account_issuer.sql";

function issuerMigrationStatement() {
  const migration = env.TEST_MIGRATIONS.find((item) => item.name === issuerMigration);
  if (!migration) throw new Error(`migration ${issuerMigration} is missing from the test bundle`);
  return migration;
}

/** A user row as every migration before 0028 shaped it. */
function legacyUser(id: string, email: string) {
  return env.DB.prepare(
    "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values (?, ?, ?, 1, 0, 'free', 0, 0)",
  ).bind(id, id, email);
}

/** An account row before 0028: no issuer column exists yet. */
async function legacyAccount(id: string, accountId: string, userId: string) {
  return env.DB.prepare(
    "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values (?, ?, 'credential', ?, ?, 0, 0)",
  ).bind(id, accountId, userId, await hashPassword(TEST_PASSWORD));
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(
    env.DB,
    env.TEST_MIGRATIONS.filter((migration) => migration.name < issuerMigration),
  );
});
afterEach(reset);

test("migration 0028 backfills credential accounts and keeps them able to sign in", async () => {
  await env.DB.batch([
    legacyUser("legacy-user", "legacy@example.com"),
    await legacyAccount("legacy-account", "legacy-user", "legacy-user"),
  ]);

  await applyD1Migrations(env.DB, [issuerMigrationStatement()]);

  const row = await env.DB.prepare(
    "select issuer, account_id from account where id = 'legacy-account'",
  ).first<{
    issuer: string;
    account_id: string;
  }>();
  expect(row).toEqual({ issuer: "local:credential", account_id: "legacy-user" });

  await signInCookie("legacy@example.com", TEST_PASSWORD);
});

test("migration 0028 backfills every account, not just the first", async () => {
  await env.DB.batch([
    legacyUser("user-a", "a@example.com"),
    legacyUser("user-b", "b@example.com"),
    await legacyAccount("account-a", "user-a", "user-a"),
    await legacyAccount("account-b", "user-b", "user-b"),
  ]);

  await applyD1Migrations(env.DB, [issuerMigrationStatement()]);

  const row = await env.DB.prepare(
    "select count(*) as count from account where issuer = 'local:credential'",
  ).first<{ count: number }>();
  expect(row?.count).toBe(2);
});

test("migration 0028 rejects when two accounts share an account id", async () => {
  await env.DB.batch([
    legacyUser("owner", "owner@example.com"),
    await legacyAccount("first", "shared", "owner"),
    await legacyAccount("second", "shared", "owner"),
  ]);

  await expect(applyD1Migrations(env.DB, [issuerMigrationStatement()])).rejects.toThrow();
});
