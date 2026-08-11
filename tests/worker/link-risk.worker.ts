import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker";
import { applyTestMigrations, authEnv, freeOwnerCookie } from "./support";
import { scoreAndRecord } from "../../src/worker/risk";

/**
 * Destination risk scoring end to end (#68).
 *
 * The resolver is stubbed here, so what these assert is the pipeline: that
 * scoring happens on the right triggers, writes the right columns, never
 * blocks or fails a write, and never reaches an org-scoped response. How the
 * resolver's answers are read is tests/risk.test.ts.
 */

const BLOCKED = "https://malware.example/x";
const CLEAN = "https://example.com/x";

const realFetch = globalThis.fetch;

/** A resolver that refuses BLOCKED's host and resolves everything else. */
function stubResolver(options: { fail?: boolean } = {}) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://security.cloudflare-dns.com")) return realFetch(input);
    calls.push(url);
    if (options.fail) throw new Error("resolver unreachable");
    const blocked = url.includes("malware.example");
    return new Response(
      JSON.stringify({ Status: 0, Answer: [{ data: blocked ? "0.0.0.0" : "93.184.216.34" }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  return calls;
}

async function call(path: string, init: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`http://localhost${path}`, init), authEnv(), ctx);
  // waitOnExecutionContext settles the waitUntil the scoring runs in, so the
  // assertions below are not racing it.
  await waitOnExecutionContext(ctx);
  return res;
}

const postLink = (cookie: string, body: Record<string, unknown>) =>
  call("/api/orgs/org-1/links", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Creates a link through the API and returns its id: every test here starts
 * this way, and only cares about what scoring did to the row afterwards. */
async function createLink(cookie: string, destination: string): Promise<string> {
  const res = await postLink(cookie, { destination });
  const { id } = (await res.json()) as { id: string };
  return id;
}

const patchLink = (cookie: string, id: string, body: Record<string, unknown>) =>
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
  reset();
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
    // It scores, it does not block. A provider outage must never cost a user
    // their link, and must not look like a clean bill of health either.
    stubResolver({ fail: true });
    const cookie = await freeOwnerCookie();
    const res = await postLink(cookie, { destination: BLOCKED });
    expect(res.status).toBe(201);

    const { id } = (await res.json()) as { id: string };
    expect((await riskRow(id))?.risk_score).toBeNull();
  });

  it("never puts a score in the org-scoped response", async () => {
    // Scores are admin-only (#67). Handing one back here would tell whoever
    // created the link exactly which destinations pass.
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
    // The attack this exists for: register something clean, pass the check,
    // then swap it.
    stubResolver();
    const cookie = await freeOwnerCookie();
    const linkId = await createLink(cookie, CLEAN);
    expect((await riskRow(linkId))?.risk_score).toBe(0);

    await patchLink(cookie, linkId, { destination: BLOCKED });
    expect((await riskRow(linkId))?.risk_score).toBe(100);
  });

  it("drops the old verdict in the same write, not after the re-scan", async () => {
    // With the resolver down there is no new verdict to write, so this shows
    // the clearing is done by the edit itself: a swapped link must not keep
    // reading clean while the re-scan is pending or failing.
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
    // The lookup is slow and the edit is not. A scan of the old destination
    // can still be in flight when the link is pointed somewhere else, and it
    // used to land afterwards and label the new destination with the old
    // one's verdict: swap a blocked link to something clean and the clean one
    // inherits 100, or the reverse, which is the direction that matters.
    //
    // Called directly with a destination the row no longer has, which is
    // exactly the state a late scan finishes in.
    stubResolver();
    const cookie = await freeOwnerCookie();
    const linkId = await createLink(cookie, CLEAN);

    await scoreAndRecord(env.DB, linkId, BLOCKED);

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
