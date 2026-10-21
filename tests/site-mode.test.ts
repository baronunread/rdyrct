import { describe, expect, test } from "bun:test";
import { isRdyrctSite } from "../scripts/site-mode";

const rdyrct = `{ "vars": { "APP_URL": "https://rdyrct.com", "APP_HOST": "rdyrct.com" } }`;
const fork = `{ "vars": { "APP_URL": "https://links.example.com", "APP_HOST": "links.example.com" } }`;

describe("isRdyrctSite", () => {
  test("a deploy to rdyrct.com is rdyrct.com, whatever command ran it", () => {
    expect(isRdyrctSite({}, rdyrct)).toBe(true);
  });

  test("a deploy to any other host is a self-hosted copy", () => {
    expect(isRdyrctSite({}, fork)).toBe(false);
    expect(isRdyrctSite({}, `{ "vars": { "APP_HOST": "rdyrct.com.example.net" } }`)).toBe(false);
  });

  test("the Deploy to Cloudflare button builds a fork, though its copy names rdyrct.com", () => {
    expect(isRdyrctSite({ WORKERS_CI: "1" }, rdyrct)).toBe(false);
  });

  test("VITE_RDYRCT_SITE overrides everything else", () => {
    expect(isRdyrctSite({ VITE_RDYRCT_SITE: "0" }, rdyrct)).toBe(false);
    expect(isRdyrctSite({ VITE_RDYRCT_SITE: "1", WORKERS_CI: "1" }, fork)).toBe(true);
  });

  test("the committed wrangler.jsonc is rdyrct.com's", () => {
    expect(isRdyrctSite({})).toBe(true);
  });
});
