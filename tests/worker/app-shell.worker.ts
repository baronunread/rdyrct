import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { applyTestMigrations, fetchWorker, overrideEnv } from "./support";

beforeEach(applyTestMigrations);
afterEach(reset);

const SHELL = `<!doctype html><html><head><title>rdyrct</title></head><body><div id="root"><div data-shell-static="">sidebar</div></div></body></html>`;
const LANDING = `<!doctype html><html><head><title>rdyrct</title></head><body><div id="root"><h1>Landing hero</h1></div></body></html>`;

// Shell files as the build writes them: .txt, served as text/plain.
function assets({ withShell }: { withShell: boolean }): Fetcher {
  return {
    fetch: async (input) => {
      const path = new URL(new Request(input).url).pathname;
      if (withShell && path.startsWith("/_app-shell/"))
        return new Response(SHELL, { headers: { "content-type": "text/plain" } });
      return new Response(LANDING, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
    connect: () => {
      throw new Error("ASSETS.connect is not used");
    },
  };
}

const get = (path: string, withShell: boolean, method = "GET") =>
  fetchWorker(
    new Request(`http://localhost${path}`, { method, redirect: "manual" }),
    overrideEnv({ ASSETS: assets({ withShell }) }),
  );

describe("the prerendered app shell", () => {
  it("answers a reload of an app page, as HTML", async () => {
    const res = await get("/links", true);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("data-shell-static");
  });

  it("is never the landing page when the build has no shell file", async () => {
    const body = await (await get("/links", false)).text();
    expect(body).not.toContain("Landing hero");
    expect(body).not.toContain("data-shell-static");
  });

  it("is not served for a page outside the app", async () => {
    const body = await (await get("/privacy", true)).text();
    expect(body).not.toContain("data-shell-static");
  });
});
