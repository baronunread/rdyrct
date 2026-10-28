import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import type { InvitePreview, MemberDTO } from "../../src/shared/types";
import { applyTestMigrations, fetchWorker, freeOwnerCookie, jsonBody } from "./support";

/**
 * What the members page and the invite's join card read about people: when
 * each member was last active, and who sent an invite.
 */

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

describe("GET /orgs/:orgId/members: lastActiveAt", () => {
  it("is the member's newest session, or null with none", async () => {
    const cookie = await freeOwnerCookie();
    await env.DB.batch([
      env.DB.prepare(
        "insert into user (id, name, email, email_verified, created_at, updated_at) values ('quiet-1', 'Quiet', 'quiet@example.com', 1, 0, 0)",
      ),
      env.DB.prepare(
        "insert into org_members (org_id, user_id, role, created_at) values ('org-1', 'quiet-1', 'viewer', 0)",
      ),
      // An older session of the owner's, beside the one signing in made.
      env.DB.prepare(
        "insert into session (id, token, user_id, expires_at, created_at, updated_at) values ('old-s', 'old-t', 'free-1', 9999999999999, 1000, 2000)",
      ),
    ]);
    const newest = await env.DB.prepare(
      "select max(updated_at) as newest from session where user_id = 'free-1'",
    ).first<number>("newest");

    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/members", { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const members = await jsonBody<MemberDTO[]>(res);
    const byId = Object.fromEntries(members.map((m) => [m.userId, m.lastActiveAt]));

    expect(newest).toBeGreaterThan(2000);
    expect(byId).toEqual({ "free-1": newest, "quiet-1": null });
  });
});

describe("GET /invites/:token: invitedBy", () => {
  async function preview(token: string) {
    const res = await fetchWorker(new Request(`http://localhost/api/invites/${token}`));
    expect(res.status).toBe(200);
    return jsonBody<InvitePreview>(res);
  }

  it("names whoever made the invite, or nobody once that account is gone", async () => {
    await freeOwnerCookie();
    const later = Date.now() + 60_000;
    await env.DB.batch([
      env.DB.prepare(
        "insert into invites (token, org_id, role, email, created_by, created_at, expires_at) values ('by-owner', 'org-1', 'member', null, 'free-1', 0, ?)",
      ).bind(later),
      env.DB.prepare(
        "insert into invites (token, org_id, role, email, created_by, created_at, expires_at) values ('orphan', 'org-1', 'viewer', null, null, 0, ?)",
      ).bind(later),
    ]);

    expect(await preview("by-owner")).toEqual({
      orgName: "Test",
      role: "member",
      invitedBy: "Free",
    });
    expect((await preview("orphan")).invitedBy).toBeNull();
  });
});
