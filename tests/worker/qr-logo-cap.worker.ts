/**
 * How many logos one org can keep in R2 (#18).
 *
 * Every upload is a new object under the org's prefix, and nothing deletes one
 * until it has gone unused for a day. A member looping uploads wrote objects
 * without end. The cap leaves room for every link to carry its own logo, plus
 * the org's default and a day of uploads nobody saved.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { PLAN_LIMITS } from "../../src/shared/types";
import { qrLogoCap } from "../../src/worker/routes/qr-logos";
import { applyTestMigrations, fetchWorker, freeOwnerCookie } from "./support";

let cookie: string;
const CAP = qrLogoCap(PLAN_LIMITS.hobby);

beforeEach(async () => {
  await reset();
  await applyTestMigrations();
  cookie = await freeOwnerCookie();
  await env.DB.prepare("update user set plan = 'hobby' where id = 'free-1'").run();
});
afterEach(reset);

function webp(): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  return bytes;
}

const upload = () =>
  fetchWorker(
    new Request("http://localhost/api/orgs/org-1/qr-logo", {
      method: "POST",
      headers: { cookie, "content-type": "image/webp" },
      body: webp(),
    }),
  );

async function stored(): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await env.MEDIA.list({ prefix: "org-1/", cursor });
    count += page.objects.length;
    if (!page.truncated) return count;
    cursor = page.cursor;
  }
}

async function fill(count: number): Promise<void> {
  for (let i = 0; i < count; i += 100)
    await Promise.all(
      Array.from({ length: Math.min(100, count - i) }, (_, k) =>
        env.MEDIA.put(`org-1/seed-${i + k}.webp`, webp()),
      ),
    );
}

describe("the per-org logo cap", () => {
  it("is a small margin over one logo per link", () => {
    expect(CAP).toBeGreaterThan(PLAN_LIMITS.hobby.links);
    expect(CAP).toBeLessThan(PLAN_LIMITS.hobby.links * 2);
  });

  it("accepts an upload below the cap", async () => {
    await fill(CAP - 1);
    const res = await upload();
    expect(res.status).toBe(201);
    expect(await stored()).toBe(CAP);
  });

  it("refuses an upload at the cap and stores nothing", async () => {
    await fill(CAP);
    const res = await upload();
    expect(res.status).toBe(429);
    expect(await stored()).toBe(CAP);
  });

  it("counts only this org's objects", async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => env.MEDIA.put(`org-2/other-${i}.webp`, webp())),
    );
    await fill(CAP - 1);
    expect((await upload()).status).toBe(201);
  });
});
