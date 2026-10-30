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

async function invite(emails: string[], refuse: string[] = []) {
  const { sent, restore } = captureEmails({ refuse });
  try {
    const res = await fetchWorker(
      new Request("http://localhost/api/orgs/org-1/invites", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ emails, role: "member" }),
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

    const { body, sent } = await invite(["down@example.com"]);
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
