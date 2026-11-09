import { describe, expect, it } from "vitest";
import { MADE_WITH_SLOT } from "../../src/shared/link-pages";
import { RDYRCT_SITE } from "../../src/shared/site";
import { notFoundPage } from "../../src/worker/not-found-page";
import { disabledPage } from "../../src/worker/link-state-page";

/**
 * The "Made with rdyrct" link on the 404 and disabled pages. The worker
 * tests have no built assets, so this hands the pages a stand-in for the
 * prerendered file with the same markers the build writes.
 */
function assetsServing(name: string): Fetcher {
  const html = `<html><body data-page="${name}"><div id="root"><a href="/">Go home</a><a data-slot="${MADE_WITH_SLOT}" href="/">Made with rdyrct</a></div></body></html>`;
  return {
    fetch: async () => new Response(html),
    connect: () => {
      throw new Error("ASSETS.connect is not used");
    },
  };
}

describe.runIf(RDYRCT_SITE)("the made-with link on rdyrct.com", () => {
  it("points the 404 on our own host at rdyrct.com, tagged, and keeps the home link", async () => {
    const res = await notFoundPage(
      assetsServing("404-short"),
      "https://rdyr.cc/gone",
      "https://rdyrct.com",
    );
    const html = await res.text();

    expect(res.status).toBe(404);
    expect(html).toContain(
      'href="https://rdyrct.com/?utm_source=short-link&utm_medium=referral&utm_campaign=made-with&utm_content=404"',
    );
    expect(html).toContain('<a href="https://rdyrct.com">Go home</a>');
  });

  it("tags the disabled page as its own", async () => {
    const res = await disabledPage(
      assetsServing("link-disabled"),
      "https://rdyr.cc/x",
      "https://rdyrct.com",
    );

    expect(res.status).toBe(410);
    expect(await res.text()).toContain("utm_content=disabled");
  });

  it("is gone on a customer's own domain", async () => {
    for (const res of [
      await notFoundPage(assetsServing("404-short"), "https://go.example.com/x", null),
      await disabledPage(assetsServing("link-disabled"), "https://go.example.com/x", null),
    ]) {
      expect(await res.text()).not.toContain("Made with rdyrct");
    }
  });
});
