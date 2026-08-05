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
    // proxyBlog calls fetch(target, { headers, ... }): the forwarded headers
    // live in the second (init) argument, not on `input` (a URL, not a
    // Request). Reading `(input as Request).headers` would always be empty,
    // so the assertions below would pass even if cookies leaked through.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      capturedHeaders.push(new Request(input, init).headers);
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
