import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, exports as worker } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";

type TestEnv = typeof env & { TEST_MIGRATIONS: D1Migration[] };

afterEach(async () => {
  // The redirect handler records clicks through waitUntil. Let that task finish
  // before Miniflare clears the test bindings.
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  ]);
});

describe("redirect hot path", () => {
  it("redirects a shared-host slug and records a click after responding", async () => {
    await env.LINKS.put(
      "slug:summer",
      JSON.stringify({ linkId: "link-1", orgId: "org-1", url: "https://example.com/sale" }),
    );

    const response = await worker.default.fetch(
      new Request("http://localhost/summer", { redirect: "manual" }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/sale");
    expect(
      (await env.DB.prepare("select count(*) as count from clicks").first<{ count: number }>())
        ?.count,
    ).toBe(1);
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

    const response = await worker.default.fetch(
      new Request("http://localhost/pricing", {
        headers: { host: "go.example.com" },
        redirect: "manual",
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/pricing");
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

    const root = await worker.default.fetch(
      new Request("http://localhost/", { headers: { host: "go.example.com" }, redirect: "manual" }),
    );
    const missing = await worker.default.fetch(
      new Request("http://localhost/no-such-link", {
        headers: { host: "go.example.com" },
        redirect: "manual",
      }),
    );

    expect(root.headers.get("location")).toBe("https://example.com/home");
    expect(missing.headers.get("location")).toBe("https://example.com/home");
  });
});
