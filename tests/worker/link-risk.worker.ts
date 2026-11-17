import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { applyTestMigrations, authEnv, freeOwnerCookie, jsonBody, recordingEnv } from "./support";
import { revalidateOnRedirect, scoreAndRecord } from "../../src/worker/risk";
import type { JsonValue } from "../../src/shared/types";

// The resolver is stubbed, so these assert the pipeline: triggers, columns
// written, never blocking a write, never reaching an org-scoped response.
// How answers are read: tests/risk.test.ts.

const BLOCKED = "https://malware.example/x";
const CLEAN = "https://example.com/x";

const realFetch = globalThis.fetch;

function stubResolver(options: { fail?: boolean } = {}) {
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://security.cloudflare-dns.com")) return realFetch(input, init);
    calls.push(url);
    if (options.fail) throw new Error("resolver unreachable");
    const blocked = url.includes("malware.example");
    return new Response(
      JSON.stringify({ Status: 0, Answer: [{ data: blocked ? "0.0.0.0" : "93.184.216.34" }] }),
      { status: 200 },
    );
  };
  return calls;
}

async function call(path: string, init: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`http://localhost${path}`, init), authEnv(), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const postLink = (cookie: string, body: JsonValue) =>
  call("/api/orgs/org-1/links", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function createLink(cookie: string, destination: string): Promise<string> {
  const res = await postLink(cookie, { destination });
  const { id } = await jsonBody<{ id: string }>(res);
  return id;
}

const patchLink = (cookie: string, id: string, body: JsonValue) =>
  call(`/api/orgs/org-1/links/${id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function riskRow(linkId: string) {
  return env.DB.prepare(
    "select risk_score, risk_reasons, risk_checked_at, risk_provider from links where id = ?",
  )
    .bind(linkId)
    .first<{
      risk_score: number | null;
      risk_reasons: string | null;
      risk_checked_at: number | null;
      risk_provider: string | null;
    }>();
}

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("scoring on create", () => {
  it("records a verdict for a destination the resolver refuses", async () => {
    stubResolver();
    const cookie = await freeOwnerCookie();
    const linkId = await createLink(cookie, BLOCKED);

    const row = await riskRow(linkId);
    expect(row?.risk_score).toBe(100);
    expect(JSON.parse(row?.risk_reasons ?? "[]")).toEqual(["dns_blocklist"]);
    expect(row?.risk_provider).toBe("cloudflare-security-dns");
    expect(row?.risk_checked_at).toBeGreaterThan(0);
  });

  it("records a clean verdict for an ordinary destination", async () => {
    stubResolver();
    const cookie = await freeOwnerCookie();
    const linkId = await createLink(cookie, CLEAN);
    expect((await riskRow(linkId))?.risk_score).toBe(0);
  });

  it("creates the link anyway when the resolver is down, and leaves it unscored", async () => {
    // It scores, it does not block. A provider outage must never cost a user their
    // link, and must not look like a clean bill of health either.
    stubResolver({ fail: true });
    const cookie = await freeOwnerCookie();
    const res = await postLink(cookie, { destination: BLOCKED });
    expect(res.status).toBe(201);

    const { id } = await jsonBody<{ id: string }>(res);
    expect((await riskRow(id))?.risk_score).toBeNull();
  });

  it("never puts a score in the org-scoped response", async () => {
    // Scores are admin-only (#67): returning one would tell the creator which destinations pass.
    stubResolver();
    const cookie = await freeOwnerCookie();
    const body = await (await postLink(cookie, { destination: BLOCKED })).text();
    expect(body).not.toContain("risk");

    const list = await (await call("/api/orgs/org-1/links", { headers: { cookie } })).text();
    expect(list).not.toContain("risk");
  });
});

describe("re-scoring on a destination edit", () => {
  it("re-scores when the destination changes", async () => {
    // The attack: register something clean, pass the check, then swap it.
    stubResolver();
    const cookie = await freeOwnerCookie();
    const linkId = await createLink(cookie, CLEAN);
    expect((await riskRow(linkId))?.risk_score).toBe(0);

    await patchLink(cookie, linkId, { destination: BLOCKED });
    expect((await riskRow(linkId))?.risk_score).toBe(100);
  });

  it("drops the old verdict in the same write, not after the re-scan", async () => {
    // With the resolver down there is no new verdict, so the edit itself must clear
    // the old one while the re-scan is pending or failing.
    stubResolver();
    const cookie = await freeOwnerCookie();
    const linkId = await createLink(cookie, CLEAN);

    globalThis.fetch = realFetch;
    stubResolver({ fail: true });
    await patchLink(cookie, linkId, { destination: BLOCKED });

    const row = await riskRow(linkId);
    expect(row?.risk_score).toBeNull();
    expect(row?.risk_checked_at).toBeNull();
  });

  it("throws away a verdict for a destination the link no longer has", async () => {
    // A scan of the old destination can still be in flight when the link is
    // repointed, and must not label the new destination with the old verdict.
    // Called directly with a destination the row no longer has, the state a late scan finishes in.
    stubResolver();
    const cookie = await freeOwnerCookie();
    const linkId = await createLink(cookie, CLEAN);

    await scoreAndRecord(env, linkId, BLOCKED);

    const row = await riskRow(linkId);
    expect(row?.risk_score).toBe(0);
    expect(row?.risk_provider).not.toBeNull();
  });

  it("leaves the verdict alone when only the title changes", async () => {
    stubResolver();
    const cookie = await freeOwnerCookie();
    const linkId = await createLink(cookie, BLOCKED);
    const before = await riskRow(linkId);

    await patchLink(cookie, linkId, { title: "Renamed" });
    expect(await riskRow(linkId)).toEqual(before);
  });
});

describe("re-checking on a click", () => {
  const clickOn = (linkId: string, url: string) =>
    revalidateOnRedirect(authEnv(), { linkId, orgId: "org-1", url });

  async function unscoredLink() {
    stubResolver();
    const linkId = await createLink(await freeOwnerCookie(), BLOCKED);
    await env.DB.prepare("update links set risk_checked_at = null, risk_score = null where id = ?")
      .bind(linkId)
      .run();
    return linkId;
  }

  it("records the verdict for the link that was clicked", async () => {
    const linkId = await unscoredLink();

    await clickOn(linkId, BLOCKED);

    expect((await riskRow(linkId))?.risk_score).toBe(100);
  });

  it("records it for every link on the host, not just the one that warmed the cache", async () => {
    // The cache is keyed by hostname but the write was keyed by link, so a host
    // scored 100 marked only the link clicked while the cache was cold and left the
    // others unscored, hiding them from the admin table's sort.
    stubResolver();
    const cookie = await freeOwnerCookie();
    // Two paths on one host: an identical destination would be merged into
    // the first link rather than making a second.
    const firstUrl = "https://malware.example/one";
    const secondUrl = "https://malware.example/two";
    const first = await createLink(cookie, firstUrl);
    const second = await createLink(cookie, secondUrl);
    for (const id of [first, second])
      await env.DB.prepare(
        "update links set risk_checked_at = null, risk_score = null where id = ?",
      )
        .bind(id)
        .run();

    await clickOn(first, firstUrl);
    expect((await riskRow(first))?.risk_score).toBe(100);

    // Second click, same host: the cache is warm, and this link still has to
    // come away with the verdict.
    await clickOn(second, secondUrl);
    expect((await riskRow(second))?.risk_score).toBe(100);
  });

  it("sends D1 nothing for a second click on a link already stamped (#489)", async () => {
    // The update's own condition made it a no-op, yet it still cost a D1 statement per click.
    const linkId = await unscoredLink();
    await clickOn(linkId, BLOCKED);
    expect((await riskRow(linkId))?.risk_score).toBe(100);

    const recording = recordingEnv();
    await revalidateOnRedirect(recording.env, { linkId, orgId: "org-1", url: BLOCKED });

    expect(recording.sql).toEqual([]);
  });

  it("still stamps a link whose destination changed after its last click", async () => {
    // The skip is keyed by destination too: an edit must not inherit it.
    stubResolver();
    const cookie = await freeOwnerCookie();
    const firstUrl = "https://malware.example/before";
    const secondUrl = "https://malware.example/after";
    const linkId = await createLink(cookie, firstUrl);
    await clickOn(linkId, firstUrl);
    await env.DB.prepare(
      "update links set destination = ?, risk_checked_at = null, risk_score = null where id = ?",
    )
      .bind(secondUrl, linkId)
      .run();

    await clickOn(linkId, secondUrl);

    expect((await riskRow(linkId))?.risk_score).toBe(100);
  });

  it("leaves a link alone when its destination has moved on", async () => {
    // KV can hold a redirect that predates an edit, and a click on it must
    // not label the new destination with the old one's verdict.
    stubResolver();
    const cookie = await freeOwnerCookie();
    const linkId = await createLink(cookie, CLEAN);
    const before = await riskRow(linkId);

    await clickOn(linkId, BLOCKED);

    expect(await riskRow(linkId)).toEqual(before);
  });
});
