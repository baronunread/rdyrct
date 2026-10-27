import { expect, test } from "@playwright/test";

/**
 * The dev scenario switcher (src/worker/dev-scenarios.ts) answers on the dev
 * server. The e2e database is not seeded, so a scenario finds no account in
 * its state and says so instead of signing anybody in; with seed data the
 * same link signs in as the seeded account (checked by hand against
 * `bun run db:seed:local`).
 */
test("the dev scenario list renders and an unseeded scenario signs nobody in", async ({
  request,
}) => {
  const list = await request.get("/__dev/scenarios");
  expect(list.status()).toBe(200);
  const html = await list.text();
  for (const name of ["pro-owner", "fresh", "over-plan", "locked-org", "admin"])
    expect(html).toContain(`/__dev/scenarios/${name}`);

  const unknown = await request.get("/__dev/scenarios/nobody");
  expect(unknown.status()).toBe(404);

  const unseeded = await request.get("/__dev/scenarios/fresh", { maxRedirects: 0 });
  expect(unseeded.status()).toBe(409);
  expect(unseeded.headers()["set-cookie"]).toBeUndefined();
});
