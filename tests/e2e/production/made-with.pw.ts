import { expect, test } from "@playwright/test";

test("a dead link on the shared host offers a tagged link to rdyrct", async ({ request }) => {
  const res = await request.get("/no-such-link-x9", { headers: { host: "rdyr.cc" } });
  expect(res.status()).toBe(404);
  const html = await res.text();
  expect(html).toContain("Made with rdyrct");
  expect(html).toMatch(
    /data-slot="made-with" href="[^"]*utm_campaign=made-with(&|&amp;)utm_content=404"/,
  );
});
