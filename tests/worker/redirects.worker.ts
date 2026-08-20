import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import type { ClickMessage } from "../../src/worker/clicks";
import {
  applyTestMigrations,
  captureClickQueue,
  fetchWorker,
  overrideEnv,
  stubQueue,
} from "./support";

afterEach(async () => {
  await reset();
});

beforeEach(async () => {
  await applyTestMigrations();
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

/** The custom domain (go.example.com -> org-1) plus its one KV-published
 * slug ("pricing" -> link-2), shared by every test that exercises
 * custom-domain resolution. */
async function putCustomDomainAndSlug(): Promise<void> {
  await env.LINKS.put(
    "domain:go.example.com",
    JSON.stringify({ domainId: "domain-1", orgId: "org-1", rootRedirect: "https://example.com" }),
  );
  await env.LINKS.put(
    "slug:go.example.com:pricing",
    JSON.stringify({ linkId: "link-2", orgId: "org-1", url: "https://example.com/pricing" }),
  );
}

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
    await putCustomDomainAndSlug();

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
    const downQueue = stubQueue<ClickMessage>(() => {
      throw new Error("injected queue-send failure");
    });
    const failingEnv = overrideEnv({ CLICK_QUEUE: downQueue });
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

  it("answers 404 on the shared host for a slug nobody registered", async () => {
    // Under a 200 this is a soft 404: the SPA shell canonicals at the landing
    // page, so every mistyped or retired short link asked a crawler to index
    // it as a duplicate of the home page. Google had five pages "discovered,
    // not indexed" and an unbounded supply of these competing for the crawl.
    const res = await fetchWorker(new Request("http://localhost/no-such-slug"));

    expect(res.status).toBe(404);
    // Still the SPA: the browser gets the app, which renders its NotFound page.
    expect(await res.text()).toContain('<div id="root">');
  });

  it("redirects a trailing-slash slug to the slash-free path, which then redirects and records a click", async () => {
    await env.LINKS.put(
      "slug:summer",
      JSON.stringify({ linkId: "link-1", orgId: "org-1", url: "https://example.com/sale" }),
    );
    const { env: testEnv, sent } = captureClickQueue();

    const trimmed = await fetchWorker(
      new Request("http://localhost/summer/", { redirect: "manual" }),
      testEnv,
    );
    expect(trimmed.status).toBe(301);
    const location = trimmed.headers.get("location");
    expect(location).toBe("http://localhost/summer");

    const followed = await fetchWorker(new Request(location!, { redirect: "manual" }), testEnv);
    expect(followed.status).toBe(302);
    expect(followed.headers.get("location")).toBe("https://example.com/sale");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ linkId: "link-1", orgId: "org-1" });
  });

  it("resolves a trailing-slash slug on a custom domain without a detour through the SPA's redirect", async () => {
    await putCustomDomainAndSlug();

    // The custom-domain middleware is a dead end for its own host (it never
    // calls next()), so it has to strip the trailing slash itself: it can't
    // rely on the shared-domain trimTrailingSlash middleware registered
    // after it.
    const res = await fetchWorker(
      new Request("http://localhost/pricing/", {
        headers: { host: "go.example.com" },
        redirect: "manual",
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/pricing");
  });

  it("still 404s a trailing-slash slug nobody registered, once trimmed", async () => {
    const trimmed = await fetchWorker(
      new Request("http://localhost/no-such-slug-xyz/", { redirect: "manual" }),
    );
    expect(trimmed.status).toBe(301);

    const followed = await fetchWorker(
      new Request(trimmed.headers.get("location")!, { redirect: "manual" }),
    );
    expect(followed.status).toBe(404);
  });

  it("leaves the app's own root keywords on 200", async () => {
    // The 404 above is decided one line below the RESERVED_SLUGS check, so the
    // way to get it wrong is to start 404ing the pages the SPA serves.
    for (const path of ["/", "/privacy", "/qr-code-generator", "/dashboard"]) {
      const res = await fetchWorker(new Request(`http://localhost${path}`));
      expect(res.status, `status of ${path}`).toBe(200);
    }
  });
});
