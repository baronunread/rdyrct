import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
import { deployedHost, selfHostConfig } from "../scripts/setup";
import { namesRdyrct } from "../scripts/site-mode";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("setup points the real wrangler.jsonc at the copy and drops rdyrct.com's own", () => {
  const out = selfHostConfig(source, "links.example.com", {
    name: "rdyrct",
    workersDev: false,
    dropIds: true,
  });
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
    name: "rdyrct",
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

test("a copy named links gets resources of its own, never rdyrct.com's", () => {
  const config = parse(
    selfHostConfig(source, "links.example.com", {
      name: "links",
      workersDev: false,
      dropIds: true,
    }),
  );
  expect(config.name).toBe("links");
  expect(config.d1_databases[0].database_name).toBe("links");
  expect(config.r2_buckets[0].bucket_name).toBe("links-qr-logos");
  expect(config.queues.producers[0].queue).toBe("links-storage");
  expect(config.queues.consumers.map((q: { queue: string }) => q.queue)).toEqual([
    "links-storage",
    "links-storage-dlq",
  ]);
  expect(config.queues.consumers[0].dead_letter_queue).toBe("links-storage-dlq");
  expect(config.workflows.map((w: { name: string }) => w.name)).toEqual([
    "links-org-delete",
    "links-domain-activate",
  ]);
  // Nothing at the top level still names an rdyrct resource.
  const { env: _playwright, ...top } = config;
  expect(JSON.stringify(top)).not.toMatch(/"rdyrct-/);
  expect(config.env.playwright.d1_databases[0].database_name).toBe("rdyrct-playwright");
});

test("the address setup reads from wrangler is the worker's, not the placeholder var", () => {
  // Trimmed from a real `wrangler deploy`: the vars come first.
  const output = `env.APP_URL ("https://pending.workers.dev")     Environment Variable
env.APP_HOST ("pending.workers.dev")           Environment Variable
Uploaded rdyrct-livetest (14.16 sec)
Deployed rdyrct-livetest triggers (7.30 sec)
  https://rdyrct-livetest.baronunreadts.workers.dev`;
  expect(deployedHost(output)).toBe("rdyrct-livetest.baronunreadts.workers.dev");
  expect(deployedHost(`env.APP_URL ("https://pending.workers.dev")`)).toBeUndefined();
});
