import { afterEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import type { Env } from "../../src/worker/env";
import { overrideEnv } from "./support";

async function fetchWorker(request: Request, testEnv: Env): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("blog reverse proxy", () => {
  it("never forwards the session cookie or an authorization header to the blog origin", async () => {
    const capturedHeaders: Headers[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      capturedHeaders.push(new Headers((input as Request).headers));
      return new Response("ok");
    });
    const testEnv = overrideEnv({ BLOG_ORIGIN_URL: "https://rdyrct-blog.vercel.app" });

    await fetchWorker(
      new Request("http://localhost/blog/hello-world", {
        headers: {
          cookie: "better-auth.session_token=super-secret",
          authorization: "Bearer super-secret",
        },
      }),
      testEnv,
    );

    expect(capturedHeaders).toHaveLength(1);
    expect(capturedHeaders[0].has("cookie")).toBe(false);
    expect(capturedHeaders[0].has("authorization")).toBe(false);
  });
});
