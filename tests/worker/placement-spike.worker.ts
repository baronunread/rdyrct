import { afterEach, beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import * as v from "valibot";
import worker from "../../spikes/placement/worker";

const bindings = {
  DB: env.DB,
  BENCH_KEY: "local-only-test-key",
  VARIANT: "test",
  LOOPBACK_ORIGIN: "https://spike.test",
};
beforeEach(async () => {
  await env.DB.exec("CREATE TABLE links (id INTEGER PRIMARY KEY, destination TEXT NOT NULL)");
  await env.DB.exec(
    "WITH RECURSIVE ids(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM ids WHERE id < 10) INSERT INTO links SELECT id, 'https://example.com/' || id FROM ids",
  );
});
afterEach(reset);

it("keeps queries private and method bounded", async () => {
  expect(
    (await worker.fetch(new Request("https://spike.test/direct", { method: "POST" }), bindings))
      .status,
  ).toBe(401);
  expect(
    (
      await worker.fetch(
        new Request("https://spike.test/direct", {
          headers: { authorization: "Bearer local-only-test-key" },
        }),
        bindings,
      )
    ).status,
  ).toBe(405);
  expect(
    (
      await worker.fetch(
        new Request("https://spike.test/not-a-route", {
          method: "POST",
          headers: { authorization: "Bearer local-only-test-key" },
        }),
        bindings,
      )
    ).status,
  ).toBe(404);
});

it("executes ten identical indexed fixture reads", async () => {
  const response = await worker.fetch(
    new Request("https://spike.test/direct", {
      method: "POST",
      headers: { authorization: "Bearer local-only-test-key" },
    }),
    bindings,
  );
  expect(response.status).toBe(200);
  const body = v.parse(
    v.object({ samples: v.array(v.object({ id: v.number() })) }),
    await response.json(),
  );
  expect(body.samples.map((sample: { id: number }) => sample.id)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ]);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
