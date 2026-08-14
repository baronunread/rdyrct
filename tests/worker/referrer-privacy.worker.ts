import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import type { ClickMessage } from "../../src/worker/clicks";
import { normalizeReferrer } from "../../src/worker/util";
import {
  applyTestMigrations,
  captureClickQueue,
  sampleLink,
  seedLink,
  testMigrations,
} from "./support";

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

  it("keeps a label of exactly the longest DNS allows", () => {
    const host = `${"a".repeat(63)}.example.com`;
    expect(normalizeReferrer(`https://${host}/`)).toBe(host);
  });

  it("returns empty for a label one character past the DNS limit", () => {
    // Total length is well under 253, so only the per-label rule can catch
    // this one.
    const host = `${"a".repeat(64)}.example.com`;
    expect(normalizeReferrer(`https://${host}/`)).toBe("");
  });

  it.each([
    ["a bare word with no dot", "https://localhost/"],
    ["a trailing dot", "https://example.com./"],
    ["a doubled dot", "https://example..com/"],
    ["an IPv6 literal", "https://[2001:db8::1]/"],
  ])("returns empty for %s, which names no site we can report on", (_label, input) => {
    expect(normalizeReferrer(input)).toBe("");
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

describe("migration 0016 leaves nothing ingestion would now refuse (#20)", () => {
  /**
   * Runs the real 0016 statements over `raw`, one seeded click each, and
   * returns what the column holds afterwards.
   *
   * The migration already ran in beforeEach, so this is a second pass over
   * rows inserted after it: fine, and worth asserting on. Every statement
   * is a no-op on a value without its delimiter, so the file is safe to
   * re-run, which is what makes this test possible at all.
   */
  async function afterMigration(raw: string[]): Promise<string[]> {
    await seedLink();
    await env.DB.batch(
      raw.map((referrer, i) =>
        env.DB.prepare(
          "insert into clicks (id, link_id, org_id, ts, country, referrer, device) values (?, ?, ?, ?, '', ?, '')",
        ).bind(i + 1, sampleLink.id, sampleLink.orgId, i + 1, referrer),
      ),
    );

    const { TEST_MIGRATIONS } = testMigrations();
    const migration = TEST_MIGRATIONS.find((m) => m.name.startsWith("0016"));
    expect(migration, "migration 0016 is missing from the test bundle").toBeTruthy();
    await env.DB.batch(migration!.queries.map((query) => env.DB.prepare(query)));

    const { results } = await env.DB.prepare("select referrer from clicks order by id").all<{
      referrer: string;
    }>();
    return results.map((row) => row.referrer);
  }

  it("reduces a stored URL to its hostname", async () => {
    expect(
      await afterMigration([
        "https://forum.example.com/threads/42?q=private+search&token=secret",
        "http://alice:hunter2@News.Example.com:8443/a/b",
      ]),
    ).toEqual(["forum.example.com", "news.example.com"]);
  });

  it("clears what did not arrive over http(s), rather than keeping its host", async () => {
    // Without the scheme check these would survive the scheme strip looking
    // exactly like real hostnames.
    expect(
      await afterMigration([
        "ftp://collector.example/dump",
        "android-app://com.example.reader/deep/link",
        "data:text/html,<script>x</script>",
      ]),
    ).toEqual(["", "", ""]);
  });

  it("clears hosts the live path refuses: control characters, bad shapes, long labels", async () => {
    const overlongLabel = `${"a".repeat(64)}.example.com`;
    expect(
      await afterMigration([
        "https://exa\tmple.com/path",
        "https://exa mple.com/path",
        "https://localhost/path",
        "https://example..com/path",
        `https://${overlongLabel}/path`,
        `https://${"a".repeat(300)}.example.com/path`,
      ]),
    ).toEqual(["", "", "", "", "", ""]);
  });

  it("agrees with normalizeReferrer on every case it is given", async () => {
    // The point of the whole exercise: one rule, two implementations, no
    // row left behind that the worker would not write today.
    const raw = [
      "https://forum.example.com/threads/42?token=secret",
      "http://EXAMPLE.com:8080/",
      `https://${"a".repeat(63)}.example.com/`,
      `https://${"a".repeat(64)}.example.com/`,
      "ftp://collector.example/dump",
      "https://localhost/",
      "https://example..com/",
      "",
    ];

    expect(await afterMigration(raw)).toEqual(raw.map(normalizeReferrer));
  });

  it("leaves an already-normalized row untouched when it runs twice", async () => {
    expect(await afterMigration(["forum.example.com", ""])).toEqual(["forum.example.com", ""]);
  });
});
