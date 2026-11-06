import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import { RDYRCT_SITE } from "../../src/shared/site";
import type { Env } from "../../src/worker/env";
import { applyTestMigrations, fetchWorker, overrideEnv } from "./support";

/** The leaving popup's code, as /api/config serves it. The popup shows the
 * code itself, so the Worker has no exit-offer route of its own. */
async function servedCode(overrides: Partial<Env>) {
  const res = await fetchWorker(new Request("http://localhost/api/config"), overrideEnv(overrides));
  const config: { exitOfferCode: string | null } = await res.json();
  return config.exitOfferCode;
}

beforeEach(async () => {
  await applyTestMigrations();
});

afterEach(async () => {
  await reset();
});

describe.runIf(RDYRCT_SITE)("the exit offer on rdyrct.com", () => {
  it("serves EXIT_OFFER_CODE in /api/config, and null when it is unset", async () => {
    expect(await servedCode({ EXIT_OFFER_CODE: "STAY20" })).toBe("STAY20");
    expect(await servedCode({ EXIT_OFFER_CODE: " " })).toBeNull();
    expect(await servedCode({ EXIT_OFFER_CODE: undefined })).toBeNull();
  });

  it("takes no email address: there is no /api/exit-offer", async () => {
    const res = await fetchWorker(
      new Request("http://localhost/api/exit-offer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "visitor@example.com" }),
      }),
      overrideEnv({ EXIT_OFFER_CODE: "STAY20" }),
    );
    expect(res.status).toBe(404);
  });
});
