import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import * as v from "valibot";

test.skip(
  !process.env.BENCH_SECRETS_FILE,
  "Live preview test requires its isolated benchmark secret file",
);
for (const variant of ["default", "smart"]) {
  test(`${variant} preview protects and returns identical direct/loopback reads`, async ({
    request,
  }) => {
    const filename = process.env.BENCH_SECRETS_FILE;
    if (!filename) throw new Error("Benchmark secret file missing");
    const { BENCH_KEY } = v.parse(
      v.object({ BENCH_KEY: v.string() }),
      JSON.parse(await readFile(filename, "utf8")),
    );
    const origin = `https://${variant}-rdyrct-placement-spike.baronunreadts.workers.dev`;
    expect((await request.post(`${origin}/direct`)).status()).toBe(401);
    const headers = { authorization: `Bearer ${BENCH_KEY}` };
    expect((await request.get(`${origin}/direct`, { headers })).status()).toBe(405);
    for (const path of ["direct", "loopback"]) {
      const response = await request.post(`${origin}/${path}`, { headers });
      expect(response.status()).toBe(200);
      const body = v.parse(
        v.object({ samples: v.array(v.object({ id: v.number() })) }),
        await response.json(),
      );
      expect(body.samples.map((sample) => sample.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
  });
}
