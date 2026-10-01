import { describe, expect, test } from "bun:test";
import { linkUrl, sharedLinkHost } from "../src/worker/util";
import type { Env } from "../src/worker/env";

// SAFETY: linkUrl and sharedLinkHost read only these three vars.
const envWith = (vars: Pick<Env, "APP_URL" | "APP_HOST" | "SHARED_LINK_HOST">) => vars as Env;

const app = { APP_URL: "https://rdyrct.com", APP_HOST: "rdyrct.com" };

describe("linkUrl", () => {
  test("a custom domain wins over either shared host", () => {
    expect(linkUrl(envWith({ ...app, SHARED_LINK_HOST: "rdyr.cc" }), "go.brand.com", "x")).toBe(
      "https://go.brand.com/x",
    );
  });

  test("a shared link uses SHARED_LINK_HOST when it is set", () => {
    expect(linkUrl(envWith({ ...app, SHARED_LINK_HOST: "rdyr.cc" }), null, "x")).toBe(
      "https://rdyr.cc/x",
    );
  });

  // A self-hoster who upgrades without setting the new var keeps the links
  // they had, on the app's own URL, rather than a crash on every request.
  test("a shared link falls back to APP_URL when it is not", () => {
    const env = envWith({ ...app, SHARED_LINK_HOST: undefined });
    expect(linkUrl(env, null, "x")).toBe("https://rdyrct.com/x");
    expect(sharedLinkHost(env)).toBe("rdyrct.com");
  });
});
