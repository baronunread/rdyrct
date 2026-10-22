/**
 * `bun run setup`: a self-hosted copy on your own Cloudflare account, from a
 * fresh clone, in one command.
 *
 * wrangler.jsonc ships rdyrct.com's deployment: its resource ids, its domain,
 * its Polar products and Sentry project. This rewrites the clone's copy into a
 * self-hosted one (`selfHostConfig`), lets wrangler create the KV namespace, D1
 * database and R2 bucket on the first deploy (automatic provisioning, which
 * only happens for bindings with no id), and applies the migrations. Run it
 * once; `bun run deploy` ships every update after that.
 */
import { $ } from "bun";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { applyEdits, modify, type JSONPath } from "jsonc-parser";
import { isRdyrctSite } from "./site-mode";

const WRANGLER = new URL("../wrangler.jsonc", import.meta.url);

/** Until the worker exists its workers.dev address is unknown, so the first
 *  deploy carries this and the second replaces it. */
const PENDING_HOST = "pending.workers.dev";

/** Vars that describe rdyrct.com's own accounts. Each one is optional, and a
 *  fork that kept ours would send mail as us or sell our products. */
const RDYRCT_ONLY_VARS = [
  "MAIL_FROM",
  "WELCOME_FROM",
  "POLAR_SERVER",
  "POLAR_PRO_PRODUCT_ID",
  "POLAR_HOBBY_PRODUCT_ID",
  "POLAR_PRO_YEARLY_PRODUCT_ID",
  "POLAR_HOBBY_YEARLY_PRODUCT_ID",
  "CF_ZONE_ID",
  "SENTRY_DSN",
];

/** wrangler.jsonc, comments kept, pointed at `host` (a custom domain or the
 *  worker's workers.dev address) instead of rdyrct.com. */
export function selfHostConfig(source: string, host: string, workersDev: boolean): string {
  const changes: [JSONPath, string | boolean | undefined][] = [
    [["kv_namespaces", 0, "id"], undefined],
    [["d1_databases", 0, "database_id"], undefined],
    [["vars", "APP_URL"], `https://${host}`],
    [["vars", "APP_HOST"], host],
    [["workers_dev"], workersDev],
    ...RDYRCT_ONLY_VARS.map((name): [JSONPath, undefined] => [["vars", name], undefined]),
  ];
  return changes.reduce(
    (text, [path, value]) =>
      applyEdits(text, modify(text, path, value, { formattingOptions: { insertSpaces: true } })),
    source,
  );
}

if (import.meta.main) {
  const source = readFileSync(WRANGLER, "utf8");
  if (!isRdyrctSite() && !source.includes(PENDING_HOST)) {
    console.log("This copy is already set up. Ship updates with `bun run deploy`.");
    process.exit(0);
  }

  const domain = prompt(
    "Domain on your Cloudflare account (links.example.com), or Enter for a workers.dev address:",
  )?.trim();
  const admin = prompt("Email of the account that will be the platform admin:")?.trim();
  if (!admin?.includes("@")) {
    console.error("The admin email is required.");
    process.exit(1);
  }

  writeFileSync(WRANGLER, selfHostConfig(source, domain || PENDING_HOST, !domain));
  // Removing a key leaves its neighbour's indent behind; your fork commits this.
  await $`bun fmt ${WRANGLER.pathname}`.quiet();

  // Wrangler creates a queue a producer names, not one only a consumer reads,
  // so the dead-letter queue has to exist first. Both fail harmlessly if they do.
  for (const queue of ["rdyrct-storage", "rdyrct-storage-dlq"]) {
    await $`bunx wrangler queues create ${queue}`.nothrow().quiet();
  }

  await $`bun run build`;
  const secrets = ".setup-secrets.env";
  writeFileSync(
    secrets,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}\nSUPERADMIN_EMAIL=${admin}\n`,
  );
  const route = domain ? ["--domain", domain] : [];
  // Printed as it runs (wrangler may ask you to log in), and kept for the URL.
  const deploy = await $`bunx wrangler deploy --secrets-file ${secrets} ${route}`
    .nothrow()
    .finally(() => rmSync(secrets));
  if (deploy.exitCode !== 0) process.exit(deploy.exitCode);
  await $`bunx wrangler d1 migrations apply DB --remote`;

  const host = domain || deploy.stdout.toString().match(/https:\/\/([\w.-]+\.workers\.dev)/)?.[1];
  if (!host) {
    console.error(
      "Deployed, but wrangler printed no workers.dev address. Set APP_URL and APP_HOST in wrangler.jsonc, then run `bun run deploy`.",
    );
    process.exit(1);
  }
  if (!domain) {
    writeFileSync(WRANGLER, selfHostConfig(source, host, true));
    // Nothing in the build reads the host, so this deploy needs no rebuild.
    await $`bunx wrangler deploy --var APP_URL:https://${host} --var APP_HOST:${host}`;
  }
  console.log(`\nDone. Open https://${host}/signup and sign up as ${admin}.`);
}
