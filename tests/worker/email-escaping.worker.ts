import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { applyTestMigrations, fetchWorker, freeOwnerCookie } from "./support";

/**
 * Captures what would go to Resend.
 *
 * sendEmail() posts with plain `fetch` (the Resend SDK cannot repoint its
 * base URL, which is what keeps the local emulator flow working), so
 * replacing the global is the honest seam: the request under assertion is
 * the one the worker would really send.
 */
function captureSends(): { sent: { subject: string; html: string }[]; restore: () => void } {
  const sent: { subject: string; html: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/emails")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { subject: string; html: string };
      sent.push(body);
      return new Response(JSON.stringify({ id: "sent" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return original(input as RequestInfo, init);
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = original) };
}

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});
afterEach(reset);

describe("outbound email escapes user-controlled values (#72)", () => {
  const hostileOrgName = `Acme</strong><a href="https://phish.example">Click to keep access</a>`;

  it("renders a hostile org name as text in the invite, not as markup", async () => {
    const cookie = await freeOwnerCookie();
    await env.DB.prepare("update orgs set name = ? where id = 'org-1'").bind(hostileOrgName).run();
    const { sent, restore } = captureSends();

    try {
      const res = await fetchWorker(
        new Request("http://localhost/api/orgs/org-1/invites", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ emails: ["recruit@example.com"], role: "member" }),
        }),
      );
      expect(res.status).toBe(201);
    } finally {
      restore();
    }

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
    const cookie = await freeOwnerCookie();
    await env.DB.prepare("update orgs set name = ? where id = 'org-1'").bind(hostileOrgName).run();
    const { sent, restore } = captureSends();

    try {
      await fetchWorker(
        new Request("http://localhost/api/orgs/org-1/invites", {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ emails: ["recruit@example.com"], role: "member" }),
        }),
      );
    } finally {
      restore();
    }

    // A subject is plain text to every client, so escaping it would show the
    // entities to the reader rather than protect them.
    expect(sent[0]!.subject).toContain(hostileOrgName);
  });
});
