import { describe, expect, it } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { testEnv } from "./support";

async function call(method: string, path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`http://localhost${path}`, { method }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("wrong method, wrong path", () => {
  it("answers 405 and names the methods the path does take", async () => {
    // /api/orgs is POST-only, so GET has to say so rather than serve the SPA.
    const res = await call("GET", "/api/orgs");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await res.json()).toEqual({ message: "Method not allowed" });
  });

  it("keeps the auth routes' own pair of methods", async () => {
    const res = await call("DELETE", "/api/auth/sign-in/email");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")?.split(", ").sort()).toEqual(["GET", "HEAD", "POST"]);
  });

  it("answers an unknown API path with JSON, not the SPA", async () => {
    const res = await call("GET", "/api/nothing-here");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ message: "Not found" });
  });
});
