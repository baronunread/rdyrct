import { describe, expect, test } from "bun:test";
import { imageOptionsFor, resolveLook } from "../src/app/lib/qr-look";

/**
 * qr-code-styling turns the logo into a data URI by fetching it with
 * XMLHttpRequest (its `saveAsBlob` step). A browser refuses that request for
 * a `data:` or `blob:` URL, the XHR never completes, and the promise the
 * drawing waits on never resolves: the code comes out empty. Measured in a
 * browser at the time: 439 paths with no logo, 0 with a data-URL one, 398
 * with `saveAsBlob: false`.
 *
 * So a logo that is already inline says so, and the library skips the step.
 * A logo that lives at a URL keeps the default, because a downloaded SVG has
 * to carry the image rather than a link to it.
 */
describe("the image options a logo needs", () => {
  test("switches off the fetch step for a data URL", () => {
    const options = imageOptionsFor(resolveLook({ logo: "data:image/webp;base64,AAAA" }));
    expect(options.saveAsBlob).toBe(false);
  });

  test("switches it off for a blob URL too", () => {
    const options = imageOptionsFor(resolveLook({ logo: "blob:https://rdyrct.com/abc-123" }));
    expect(options.saveAsBlob).toBe(false);
  });

  test("leaves it alone for a logo served from a URL", () => {
    const options = imageOptionsFor(resolveLook({ logo: "/api/orgs/o1/qr-logo/a.webp" }));
    expect("saveAsBlob" in options).toBe(false);
  });

  test("leaves it alone when there is no logo", () => {
    expect("saveAsBlob" in imageOptionsFor(resolveLook({}))).toBe(false);
  });

  test("passes the logo size through either way", () => {
    expect(
      imageOptionsFor(resolveLook({ logo: "data:image/png;base64,A", logoSize: 0.5 })),
    ).toEqual({ margin: 4, imageSize: 0.5, saveAsBlob: false });
  });
});
