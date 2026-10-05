import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import {
  applyTestMigrations,
  authEnv,
  failingKv,
  fetchWorker,
  freeOwnerCookie,
  jsonBody,
  overrideEnv,
  overriding,
} from "./support";

/**
 * A link works the moment its create request returns.
 *
 * In production a new link used to 404 for its first seconds, while the
 * storage queue waited out its batch window, and a click in that window made
 * KV cache the miss for up to a minute. Now the KV write happens in the
 * request, and a KV miss falls back to D1.
 */

// SAFETY: vitest.config.ts sets SHARED_LINK_HOST for the worker tests.
const SHARED_HOST = env.SHARED_LINK_HOST!;

beforeEach(async () => {
  reset();
  await applyTestMigrations();
});

async function createLink(destination: string, testEnv = authEnv()): Promise<string> {
  const cookie = await freeOwnerCookie();
  const res = await fetchWorker(
    new Request("http://localhost/api/orgs/org-1/links", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ destination }),
    }),
    testEnv,
  );
  expect(res.status).toBe(201);
  return (await jsonBody<{ slug: string }>(res)).slug;
}

// A Request built here carries no Host header, and the short-link hosts are
// routed on it, so set it from the URL or every request lands on the app.
const follow = (url: string, testEnv = authEnv()) =>
  fetchWorker(
    new Request(url, { redirect: "manual", headers: { host: new URL(url).host } }),
    testEnv,
  );

describe("a new link", () => {
  it("is in KV before its create request returns", async () => {
    const slug = await createLink("https://example.com/fresh");
    expect(await env.LINKS.get(`slug:${slug}`)).not.toBeNull();
    const res = await follow(`http://localhost/${slug}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/fresh");
  });
});

// The KV write failed and went to the queue (stubbed here, so it never
// lands): the link still answers, from D1.
describe("a link KV does not have", () => {
  const createWithoutKv = (destination: string) =>
    createLink(destination, overrideEnv({ ...authEnv(), LINKS: failingKv() }));

  it("redirects on the app host", async () => {
    const slug = await createWithoutKv("https://example.com/from-d1");
    expect(await env.LINKS.get(`slug:${slug}`)).toBeNull();
    const res = await follow(`http://localhost/${slug}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/from-d1");
  });

  it("redirects on the shared link host", async () => {
    const slug = await createWithoutKv("https://example.com/from-d1-short");
    const res = await follow(`http://${SHARED_HOST}/${slug}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/from-d1-short");
  });

  // Read through the same function that writes KV, so a suspended link
  // stays dark on this path too.
  it("still refuses a suspended link", async () => {
    const slug = await createWithoutKv("https://example.com/suspended");
    await env.DB.prepare("update links set suspended_at = ? where org_id = 'org-1'")
      .bind(Date.now())
      .run();
    expect((await follow(`http://localhost/${slug}`)).status).toBe(404);
  });
});

describe("a miss", () => {
  it("is a 404 for a slug nobody made", async () => {
    expect((await follow("http://localhost/nobodys1")).status).toBe(404);
  });

  // D1 down must not turn every unknown slug into a 500: the redirect path
  // answered from KV alone before the fallback existed.
  it("is a 404, not a 500, when D1 fails", async () => {
    const DB = overriding(env.DB, {
      prepare: () => {
        throw new Error("D1 unavailable");
      },
    });
    const res = await follow(`http://${SHARED_HOST}/nobodys2`, overrideEnv({ ...authEnv(), DB }));
    expect(res.status).toBe(404);
  });

  // Scanners ask for these by the thousand. None can be a slug, so none
  // costs a D1 read: a database that throws on use proves it was not asked.
  it("never reads D1 for a path that cannot be a slug", async () => {
    const DB = overriding(env.DB, {
      prepare: () => {
        throw new Error("D1 was read");
      },
    });
    const noDb = overrideEnv({ ...authEnv(), DB });
    for (const path of ["/wp-login.php", "/.env", "/apple-touch-icon-120x120.png"]) {
      const res = await follow(`http://${SHARED_HOST}${path}`, noDb);
      expect(res.status).toBe(404);
    }
  });
});

// rdyr.cc and custom domains never boot the app, so their miss is a small
// page of its own rather than the plain text it used to be.
describe("the page a short-link host 404s with", () => {
  it("is styled HTML on the shared host, with a way back to rdyrct", async () => {
    const res = await follow(`http://${SHARED_HOST}/nobodys3`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("This short link does not exist");
    expect(html).toContain(`href="${env.APP_URL}"`);
  });

  it("names nobody on a customer's own domain", async () => {
    await env.LINKS.put(
      "domain:go.example.com",
      JSON.stringify({ domainId: "d-1", orgId: "org-1", rootRedirect: "" }),
    );
    const res = await follow("http://go.example.com/nobodys4");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("This short link does not exist");
    expect(html).not.toContain("rdyrct");
  });
});
