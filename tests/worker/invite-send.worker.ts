import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import type { InvitesCreated } from "../../src/shared/types";
import { applyTestMigrations, captureEmails, fetchWorker, freeOwnerCookie } from "./support";

let cookie: string;
beforeEach(async () => {
  await reset();
  await applyTestMigrations();
  cookie = await freeOwnerCookie();
});
afterEach(reset);

async function invite(emails: string[], refuse: string[] = [], resend?: boolean) {
  const { sent, restore } = captureEmails({ refuse });
  try {
    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/invites", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ emails, role: "member", resend }),
      }),
    );
    // SAFETY: a 201 from this route is always an InvitesCreated body.
    return { status: res.status, body: (await res.json()) as InvitesCreated, sent };
  } finally {
    restore();
  }
}

const tokensFor = async (email: string) =>
  (
    await env.DB.prepare("select token from invites where org_id = 'org-1' and email = ?")
      .bind(email)
      .all<{ token: string }>()
  ).results.map((r) => r.token);

describe("email invites when a send fails", () => {
  it("still answers 201, names the address that failed, and sends the rest", async () => {
    const { status, body, sent } = await invite(
      ["ok@example.com", "down@example.com"],
      ["down@example.com"],
    );
    expect(status).toBe(201);
    expect(body.failed).toEqual(["down@example.com"]);
    expect(body.invites.map((i) => i.email).sort()).toEqual(["down@example.com", "ok@example.com"]);
    expect(sent.map((m) => m.to)).toEqual(["ok@example.com"]);
  });

  it("a retry reuses the open invite instead of adding a second one", async () => {
    await invite(["down@example.com"], ["down@example.com"]);
    const [first] = await tokensFor("down@example.com");

    const { body, sent } = await invite(["down@example.com"], [], true);
    expect(body.failed).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(await tokensFor("down@example.com")).toEqual([first]);
    expect(body.invites[0]!.token).toBe(first);
  });

  it("a retry takes no extra seat", async () => {
    // Free allows 3 members: the owner plus two open invites fill it.
    await invite(["a@example.com", "b@example.com"], ["b@example.com"]);
    const { status } = await invite(["b@example.com"]);
    expect(status).toBe(201);
  });
});

describe("asking again for an address that already has an invite (#15)", () => {
  it("does not mail it again unless the caller asks for a resend", async () => {
    const first = await invite(["victim@example.com"]);
    expect(first.sent).toHaveLength(1);
    expect(first.body.reused).toEqual([]);

    const again = await invite(["victim@example.com"]);
    expect(again.status).toBe(201);
    expect(again.sent).toEqual([]);
    expect(again.body.reused).toEqual(["victim@example.com"]);
    expect(again.body.failed).toEqual([]);
    expect(again.body.invites[0]!.token).toBe(first.body.invites[0]!.token);
  });

  it("mails only the new address in a mixed request", async () => {
    await invite(["old@example.com"]);
    const { sent, body } = await invite(["old@example.com", "new@example.com"]);
    expect(sent.map((m) => m.to)).toEqual(["new@example.com"]);
    expect(body.reused).toEqual(["old@example.com"]);
  });

  it("mails it again when the caller asks for a resend", async () => {
    await invite(["resend@example.com"]);
    const { sent, body } = await invite(["resend@example.com"], [], true);
    expect(sent.map((m) => m.to)).toEqual(["resend@example.com"]);
    expect(body.reused).toEqual([]);
  });
});

describe("the per-recipient email budget (#15)", () => {
  it("caps how many invites one inbox gets, however often it is resent", async () => {
    let mailed = 0;
    let refused = 0;
    for (let i = 0; i < 12; i++) {
      const { status, sent, body } = await invite(["inbox@example.com"], [], true);
      expect(status).toBe(201);
      mailed += sent.length;
      refused += body.failed.length;
    }
    // RL_EMAIL_RECIPIENT allows 4 a minute, the same budget /api/auth/* spends.
    expect(mailed).toBeLessThanOrEqual(4);
    expect(mailed).toBeGreaterThan(0);
    expect(refused).toBe(12 - mailed);
  });
});
