import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionContext, reset, waitOnExecutionContext } from "cloudflare:test";
import { asWideEvent } from "../../src/worker/evlog";
import { logFailure } from "../../src/worker/log-failure";
import { applyTestMigrations, fetchWorker, freeOwnerCookie } from "./support";

/** Everything printed to the console while `run` ran, colours stripped. Outside
 * production evlog pretty-prints each wide event there. */
async function printedDuring(run: () => Promise<Response>): Promise<string> {
  const spies = (["log", "info", "warn", "error"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
  await run();
  return stripVTControlCharacters(
    spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n"),
  );
}

describe("wide event request context", () => {
  beforeEach(applyTestMigrations);
  afterEach(() => {
    vi.restoreAllMocks();
    return reset();
  });

  it("names the event by its route and says who asked, by id only", async () => {
    const cookie = await freeOwnerCookie();
    const out = await printedDuring(() =>
      fetchWorker(new Request("http://localhost/api/orgs/nope/links", { headers: { cookie } })),
    );
    expect(out).toMatch(/route: \/api\/orgs\/:orgId\/links/);
    expect(out).toMatch(/user: id=free-1 plan=free admin=false/);
    expect(out).not.toContain("free@example.com");
  });
});

describe("background wide events", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gathers every failure in a run onto one event, and rethrows a throw", async () => {
    const ctx = createExecutionContext();
    const out = await printedDuring(async () => {
      await asWideEvent(ctx, { kind: "cron", name: "*/10 * * * *" }, async () => {
        logFailure("first_failed", new Error("boom"), { linkId: "l-1" });
        logFailure("second_failed", undefined, { reason: "missing" });
      });
      await expect(
        asWideEvent(ctx, { kind: "queue", name: "rdyrct-storage", size: 3 }, async () => {
          throw new Error("batch exploded");
        }),
      ).rejects.toThrow("batch exploded");
      await waitOnExecutionContext(ctx);
      return new Response();
    });
    expect(out).toContain("*/10 * * * *");
    expect(out).toContain("first_failed");
    expect(out).toContain("Error: boom");
    expect(out).toContain("second_failed");
    expect(out).toContain("batch exploded");
  });
});
