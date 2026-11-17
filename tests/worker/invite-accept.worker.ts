/**
 * What spends an invite token, and what must not (#156). The token delete asks
 * SQLite's `changes()` whether the insert before it in the batch landed. These
 * run on miniflare's SQLite, not D1, so they pin what the code depends on.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { acceptInviteAtomically } from "../../src/worker/plan";
import { applyTestMigrations, testEnv } from "./support";

const ORG = "org-invite-race";
const USER = "user-invite-race";
const LIMIT = 25;

afterEach(reset);

async function seed(): Promise<void> {
  await applyTestMigrations();
  await env.DB.batch([
    env.DB.prepare("insert into orgs (id, name, created_at) values (?, 'Race Co', 0)").bind(ORG),
    env.DB.prepare(
      "insert into user (id, name, email, email_verified, is_admin, plan, created_at, updated_at) values (?, 'Racer', 'racer@example.com', 1, 0, 'free', 0, 0)",
    ).bind(USER),
  ]);
}

async function makeInvite(token: string): Promise<void> {
  await env.DB.prepare(
    "insert into invites (token, org_id, role, email, created_by, created_at, expires_at) values (?, ?, 'member', null, null, 0, ?)",
  )
    .bind(token, ORG, Date.now() + 86_400_000)
    .run();
}

const inviteCount = async (): Promise<number> =>
  (await env.DB.prepare("select count(*) as n from invites where org_id = ?").bind(ORG).first<{
    n: number;
  }>())!.n;

describe("changes() inside a D1 batch", () => {
  beforeEach(async () => {
    await applyTestMigrations();
    await env.DB.exec("create table if not exists probe (id text primary key)");
    await env.DB.exec("delete from probe");
    await env.DB.prepare("insert into probe (id) values ('target')").run();
  });

  it("is 1 for a statement that wrote, so the follow-up fires", async () => {
    await env.DB.batch([
      env.DB.prepare("insert into probe (id) select 'written' where 1 = 1"),
      env.DB.prepare("delete from probe where id = 'target' and changes() = 1"),
    ]);
    const row = await env.DB.prepare("select count(*) as n from probe where id = 'target'").first<{
      n: number;
    }>();
    expect(row!.n).toBe(0);
  });

  it("is 0 for a statement that wrote nothing, so the follow-up does not", async () => {
    await env.DB.batch([
      env.DB.prepare("insert into probe (id) select 'skipped' where 1 = 0"),
      env.DB.prepare("delete from probe where id = 'target' and changes() = 1"),
    ]);
    const row = await env.DB.prepare("select count(*) as n from probe where id = 'target'").first<{
      n: number;
    }>();
    expect(row!.n).toBe(1);
  });
});

describe("acceptInviteAtomically", () => {
  beforeEach(seed);

  it("spends the token it accepted", async () => {
    await makeInvite("token-a");
    const ts = Date.now();
    const accepted = await acceptInviteAtomically(testEnv, {
      orgId: ORG,
      userId: USER,
      role: "member",
      ts,
      memberLimit: LIMIT,
      token: "token-a",
    });
    expect(accepted).toBe(true);
    expect(await inviteCount()).toBe(0);
  });

  it("leaves a second token alone when the same user accepts both in one millisecond", async () => {
    // The same `ts` is what two requests in one millisecond produce. The second
    // insert is refused, so its token must survive for the admin to hand out.
    await makeInvite("token-a");
    await makeInvite("token-b");
    const ts = Date.now();
    const args = { orgId: ORG, userId: USER, role: "member" as const, ts, memberLimit: LIMIT };

    const first = await acceptInviteAtomically(testEnv, { ...args, token: "token-a" });
    const second = await acceptInviteAtomically(testEnv, { ...args, token: "token-b" });

    expect(first).toBe(true);
    expect(second).toBe(false);
    const left = await env.DB.prepare("select token from invites where org_id = ?")
      .bind(ORG)
      .all<{ token: string }>();
    expect(left.results.map((r) => r.token)).toEqual(["token-b"]);
  });

  it("leaves the token alone when the org is full", async () => {
    await makeInvite("token-a");
    const accepted = await acceptInviteAtomically(testEnv, {
      orgId: ORG,
      userId: USER,
      role: "member",
      ts: Date.now(),
      memberLimit: 0,
      token: "token-a",
    });
    expect(accepted).toBe(false);
    expect(await inviteCount()).toBe(1);
  });
});
