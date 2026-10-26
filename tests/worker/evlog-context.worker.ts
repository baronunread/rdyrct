import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reset } from "cloudflare:test";
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
