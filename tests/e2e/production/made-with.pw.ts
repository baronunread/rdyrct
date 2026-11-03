import { expect, test } from "@playwright/test";

/**
 * The "Made with rdyrct" link on a dead short link's page, from the built
 * Worker and its prerendered 404. The shared link host is told apart by its
 * Host header (SHARED_LINK_HOST in .dev.vars.playwright), so asking for a
 * slug nobody made, as rdyr.cc, gets the page a stranger sees.
 */
test("a dead link on the shared host offers a tagged link to rdyrct", async ({ request }) => {
  const res = await request.get("/no-such-link-x9", { headers: { host: "rdyr.cc" } });
  expect(res.status()).toBe(404);
  const html = await res.text();
  expect(html).toContain("Made with rdyrct");
  expect(html).toMatch(
    /data-slot="made-with" href="[^"]*utm_campaign=made-with(&|&amp;)utm_content=404"/,
  );
});
