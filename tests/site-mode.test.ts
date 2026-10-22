import { describe, expect, test } from "bun:test";
import { isRdyrctSite, namesRdyrct } from "../scripts/site-mode";

describe("isRdyrctSite", () => {
  test("only VITE_RDYRCT_SITE=1 builds rdyrct.com", () => {
    expect(isRdyrctSite({ VITE_RDYRCT_SITE: "1" })).toBe(true);
  });

  test("no flag, or any other value, builds a self-hosted copy", () => {
    expect(isRdyrctSite({})).toBe(false);
    expect(isRdyrctSite({ VITE_RDYRCT_SITE: "0" })).toBe(false);
    expect(isRdyrctSite({ VITE_RDYRCT_SITE: "true" })).toBe(false);
  });
});

describe("namesRdyrct", () => {
  test("matches rdyrct.com's own deploy target and nothing else", () => {
    expect(namesRdyrct(`{ "vars": { "APP_HOST": "rdyrct.com" } }`)).toBe(true);
    expect(namesRdyrct(`{ "vars": { "APP_HOST": "links.example.com" } }`)).toBe(false);
    expect(namesRdyrct(`{ "vars": { "APP_HOST": "rdyrct.com.example.net" } }`)).toBe(false);
  });
});
