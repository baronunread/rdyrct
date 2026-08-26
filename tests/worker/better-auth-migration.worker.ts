import { afterEach, beforeEach, expect, test } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { hashPassword } from "../../src/worker/password";
import { signInCookie, TEST_PASSWORD } from "./support";

const issuerMigration = "0028_better_auth_account_issuer.sql";

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
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values ('legacy-user', 'Legacy', 'legacy@example.com', 1, 0, 'free', 0, 0)",
    ),
    env.DB.prepare(
      "insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('legacy-account', 'legacy-user', 'credential', 'legacy-user', ?, 0, 0)",
    ).bind(await hashPassword(TEST_PASSWORD)),
  ]);

  const migration = env.TEST_MIGRATIONS.find((item) => item.name === issuerMigration);
  expect(migration, "migration 0028 is missing from the test bundle").toBeTruthy();
  await applyD1Migrations(env.DB, [migration!]);

  const row = await env.DB.prepare(
    "select issuer, account_id from account where id = 'legacy-account'",
  ).first<{
    issuer: string;
    account_id: string;
  }>();
  expect(row).toEqual({ issuer: "local:credential", account_id: "legacy-user" });

  await signInCookie("legacy@example.com", TEST_PASSWORD);
});
