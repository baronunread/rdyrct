import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import worker from "../../src/worker";
import type { Env } from "../../src/worker/env";
import type { ClickMessage } from "../../src/worker/clicks";
import { overrideEnv } from "./support";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };

async function fetchWorker(request: Request, testEnv: Env = env as Env): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

// A CLICK_QUEUE that records what was sent, so the redirect path's enqueue
// can be asserted without a live queue delivering the message back into the
// worker under test (consumption is covered by tests/worker/clicks.worker.ts).
function captureClickQueue(): { env: Env; sent: ClickMessage[] } {
  const sent: ClickMessage[] = [];
  const CLICK_QUEUE = {
    async send(message: ClickMessage) {
      sent.push(message);
    },
  } as unknown as Queue<ClickMessage>;
  return { env: overrideEnv({ CLICK_QUEUE }), sent };
}

afterEach(async () => {
  await reset();
});

beforeEach(async () => {
  const testEnv = env as TestEnv;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB.prepare("insert into orgs (id, name, created_at) values (?, ?, ?)").bind(
      "org-1",
      "Test org",
      0,
    ),
    env.DB.prepare(
      "insert into links (id, org_id, slug, destination, created_at) values (?, ?, ?, ?, ?)",
    ).bind("link-1", "org-1", "summer", "https://example.com/sale", 0),
    env.DB.prepare(
      "insert into links (id, org_id, slug, destination, created_at) values (?, ?, ?, ?, ?)",
    ).bind("link-2", "org-1", "pricing", "https://example.com/pricing", 0),
    env.DB.prepare("insert into orgs (id, name, created_at) values (?, ?, ?)").bind(
      "org-limited",
      "Rate-limited org",
      0,
    ),
    env.DB.prepare(
      "insert into links (id, org_id, slug, destination, created_at) values (?, ?, ?, ?, ?)",
    ).bind("link-limited", "org-limited", "viral", "https://example.com/viral", 0),
  ]);
});

describe("redirect hot path", () => {
  it("redirects a shared-host slug and enqueues a click after responding", async () => {
    await env.LINKS.put(
      "slug:summer",
      JSON.stringify({ linkId: "link-1", orgId: "org-1", url: "https://example.com/sale" }),
    );
    const { env: testEnv, sent } = captureClickQueue();

    const response = await fetchWorker(
      new Request("http://localhost/summer", { redirect: "manual" }),
      testEnv,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/sale");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ linkId: "link-1", orgId: "org-1" });
    expect(
      (await env.DB.prepare("select count(*) as count from clicks").first<{ count: number }>())
        ?.count,
    ).toBe(0);
  });

  it("keeps custom-domain links separate from shared-host links", async () => {
    await env.LINKS.put(
      "domain:go.example.com",
      JSON.stringify({ domainId: "domain-1", orgId: "org-1", rootRedirect: "https://example.com" }),
    );
    await env.LINKS.put(
      "slug:go.example.com:pricing",
      JSON.stringify({ linkId: "link-2", orgId: "org-1", url: "https://example.com/pricing" }),
    );

    const response = await fetchWorker(
      new Request("http://localhost/pricing", {
        headers: { host: "go.example.com" },
        redirect: "manual",
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/pricing");
  });

  it("still redirects and skips the click enqueue when analytics is limited", async () => {
    await env.LINKS.put(
      "slug:viral",
      JSON.stringify({
        linkId: "link-limited",
        orgId: "org-limited",
        url: "https://example.com/viral",
      }),
    );
    await env.RL_CLICK_RECORDING.limit({ key: "click:org:org-limited" });
    const { env: testEnv, sent } = captureClickQueue();

    const response = await fetchWorker(
      new Request("http://localhost/viral", { redirect: "manual" }),
      testEnv,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/viral");
    expect(sent).toEqual([]);
  });

  it("still redirects when the click queue send itself fails", async () => {
    await env.LINKS.put(
      "slug:summer",
      JSON.stringify({ linkId: "link-1", orgId: "org-1", url: "https://example.com/sale" }),
    );
    const failingEnv = overrideEnv({
      CLICK_QUEUE: {
        async send() {
          throw new Error("injected queue-send failure");
        },
      } as unknown as Queue<ClickMessage>,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await fetchWorker(
      new Request("http://localhost/summer", { redirect: "manual" }),
      failingEnv,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/sale");
    expect(errors).toHaveBeenCalledWith("click enqueue failed", expect.any(Error));
    errors.mockRestore();
  });

  it("uses a custom domain's root redirect for the root and missing slugs", async () => {
    await env.LINKS.put(
      "domain:go.example.com",
      JSON.stringify({
        domainId: "domain-1",
        orgId: "org-1",
        rootRedirect: "https://example.com/home",
      }),
    );

    const root = await fetchWorker(
      new Request("http://localhost/", { headers: { host: "go.example.com" }, redirect: "manual" }),
    );
    const missing = await fetchWorker(
      new Request("http://localhost/no-such-link", {
        headers: { host: "go.example.com" },
        redirect: "manual",
      }),
    );

    expect(root.headers.get("location")).toBe("https://example.com/home");
    expect(missing.headers.get("location")).toBe("https://example.com/home");
  });
});
