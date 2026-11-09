import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  applyTestMigrations,
  captureEmails as captureSends,
  type CapturedEmail,
  fetchWorker,
  freeOwnerCookie,
} from "./support";

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});
afterEach(reset);

describe("outbound email escapes user-controlled values (#72)", () => {
  const hostileOrgName = `Acme</strong><a href="https://phish.example">Click to keep access</a>`;

  /** Invites one address from org-1 and hands back the mail that went out.
   * `orgName` renames the org first, which is how a hostile name gets into
   * the message in the first place. */
  async function invite(orgName?: string): Promise<{ status: number; sent: CapturedEmail[] }> {
    const cookie = await freeOwnerCookie();
    if (orgName)
      await env.DB.prepare("update orgs set name = ? where id = 'org-1'").bind(orgName).run();
    const { sent, restore } = captureSends();
    try {
      const res = await fetchWorker(
        new Request("http://localhost/api/orgs/org-1/invites", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ emails: ["recruit@example.com"], role: "member" }),
        }),
      );
      return { status: res.status, sent };
    } finally {
      restore();
    }
  }

  it("renders a hostile org name as text in the invite, not as markup", async () => {
    const { status, sent } = await invite(hostileOrgName);
    expect(status).toBe(201);

    expect(sent).toHaveLength(1);
    const { html } = sent[0]!;

    // The attacker's URL may appear as text (it is part of the name they
    // chose). What it may not do is be a link: no live href, and exactly one
    // anchor in the message, ours.
    expect(html).not.toContain(`href="https://phish.example"`);
    expect(html.match(/<a\s/g) ?? []).toHaveLength(1);
    expect(html).toContain("/invite/");
    // The name still reads correctly, just as text.
    expect(html).toContain("Acme&lt;/strong&gt;");
  });

  it("leaves the subject line readable, since it is not markup", async () => {
    const { sent } = await invite(hostileOrgName);

    // A subject is plain text to every client, so escaping it would show the
    // entities to the reader rather than protect them.
    expect(sent[0]!.subject).toContain(hostileOrgName);
  });

  it("sends a plain-text part alongside the HTML (#73)", async () => {
    const { sent } = await invite();

    const { text } = sent[0]!;
    expect(text).toContain("You're invited to join Test");
    expect(text).toContain("Accept the invite: http://localhost/invite/");
    expect(text).not.toContain("<");
  });
});
