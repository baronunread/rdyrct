import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import type { ClickMessage } from "../../src/worker/clicks";
import { normalizeReferrer } from "../../src/worker/util";
import { applyTestMigrations, captureClickQueue, sampleLink, seedLink } from "./support";

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});
afterEach(reset);

describe("normalizeReferrer (#20)", () => {
  it("keeps only the hostname, dropping path, query and fragment", () => {
    expect(normalizeReferrer("https://news.example.com/search?q=medical+advice#results")).toBe(
      "news.example.com",
    );
  });

  it("drops credentials and port", () => {
    expect(normalizeReferrer("https://alice:hunter2@example.com:8443/a/b")).toBe("example.com");
  });

  it("lowercases the host so one site is one row in the breakdown", () => {
    expect(normalizeReferrer("https://News.EXAMPLE.com/")).toBe("news.example.com");
  });

  it("returns empty for a direct visit", () => {
    expect(normalizeReferrer("")).toBe("");
  });

  it.each([
    ["not a url at all", "not a url at all"],
    ["a scheme we cannot attribute", "javascript:alert(1)"],
    ["a data url", "data:text/html,<script>x</script>"],
    ["a file url", "file:///Users/someone/secret.html"],
    ["a bare host with no scheme", "example.com/path"],
  ])("returns empty for %s", (_label, input) => {
    expect(normalizeReferrer(input)).toBe("");
  });

  it("returns empty rather than truncating an over-long host", () => {
    const host = `${"a".repeat(300)}.example.com`;
    expect(normalizeReferrer(`https://${host}/`)).toBe("");
  });

  it("strips control characters instead of storing them", () => {
    // URL parsing removes tabs and newlines outright, so a header trying to
    // smuggle them cannot reach the column.
    expect(normalizeReferrer("https://exa\tmple.com/\npath")).toBe("example.com");
  });
});

describe("click ingestion stores a hostname, not a URL (#20)", () => {
  // Asserts on the queued message rather than a stored row: the claim under
  // test is that the URL's path and query never leave the request handler.
  async function redirectWithReferer(referer: string): Promise<ClickMessage> {
    await seedLink();
    await env.LINKS.put(
      `slug:${sampleLink.slug}`,
      JSON.stringify({
        linkId: sampleLink.id,
        orgId: sampleLink.orgId,
        url: sampleLink.destination,
      }),
    );
    const { env: testEnv, sent } = captureClickQueue();

    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`http://localhost/${sampleLink.slug}`, {
        headers: { referer },
        redirect: "manual",
      }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(302);
    expect(sent).toHaveLength(1);
    return sent[0]!;
  }

  it("reduces a referring URL to its hostname before the click is enqueued", async () => {
    const message = await redirectWithReferer(
      "https://forum.example.com/thread/42?user=alice&token=secret",
    );

    expect(message.referrer).toBe("forum.example.com");
    expect(message.referrer).not.toContain("secret");
  });

  it("records a direct visit as empty rather than inventing a source", async () => {
    const message = await redirectWithReferer("");
    expect(message.referrer).toBe("");
  });

  it("drops a referrer it cannot attribute instead of storing it raw", async () => {
    const message = await redirectWithReferer("android-app://com.example.reader/deep/link");
    expect(message.referrer).toBe("");
  });
});
