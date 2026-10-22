import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { selfHostConfig } from "../scripts/setup";
import { namesRdyrct } from "../scripts/site-mode";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("setup points the real wrangler.jsonc at the copy and drops rdyrct.com's own", () => {
  const out = selfHostConfig(source, "links.example.com", { workersDev: false, dropIds: true });
  const config = parse(out);

  // Every other top-level var is rdyrct.com's: its mail sender, Polar
  // products, zone and Sentry project.
  expect(config.vars).toEqual({
    APP_URL: "https://links.example.com",
    APP_HOST: "links.example.com",
  });
  expect(namesRdyrct(out)).toBe(false);
  // No id, so Wrangler creates the copy's own resources on its first deploy.
  expect(config.kv_namespaces[0].id).toBeUndefined();
  expect(config.d1_databases[0].database_id).toBeUndefined();
  expect(config.d1_databases[0].database_name).toBe("rdyrct");
  expect(config.workers_dev).toBe(false);
  // Comments survive, and the test environment keeps its fixed ids.
  expect(out).toContain("// Click ingestion (#225).");
  expect(config.env.playwright.d1_databases[0].database_id).toBeDefined();
});

test("the Deploy button's copy keeps the ids Cloudflare wrote and serves workers.dev", () => {
  const button = selfHostConfig(source, "rdyrct.me.workers.dev", {
    workersDev: true,
    dropIds: false,
  });
  const config = parse(button);
  expect(config.workers_dev).toBe(true);
  expect(config.kv_namespaces[0].id).toBe(parse(source).kv_namespaces[0].id);
  // deploy.ts rewrites only a config that still names rdyrct.com.
  expect(namesRdyrct(source)).toBe(true);
  expect(namesRdyrct(button)).toBe(false);
});
