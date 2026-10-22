/**
 * `bun run setup`: a self-hosted copy on your own Cloudflare account, from a
 * fresh clone, in one command. `deploySelfHosted` is also what the Deploy to
 * Cloudflare button runs (through scripts/deploy.ts) on every build of the
 * repository it makes.
 *
 * wrangler.jsonc ships rdyrct.com's deployment: its resource ids, its domain,
 * its Polar products and Sentry project. This rewrites the copy's config into a
 * self-hosted one (`selfHostConfig`), lets wrangler create the KV namespace, D1
 * database and R2 bucket on the first deploy (automatic provisioning, which
 * only happens for bindings with no id), and applies the migrations.
 */
import { $ } from "bun";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { applyEdits, modify, parse, type JSONPath } from "jsonc-parser";
import * as v from "valibot";
import { namesRdyrct } from "./site-mode";

const WRANGLER = new URL("../wrangler.jsonc", import.meta.url);

/** Until the worker exists its workers.dev address may be unknown, so the
 *  first deploy carries this and a second one replaces it. */
const PENDING_HOST = "pending.workers.dev";

/** Vars that describe rdyrct.com's own accounts. Each one is optional, and a
 *  copy that kept ours would report its errors to our Sentry project. */
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

type Target = {
  /** The worker's name. Every resource the copy creates is named after it
   *  (`links` gets `links-storage`, `links-qr-logos`, ...), because Wrangler
   *  finds a resource with no id by its name: a copy that kept ours would bind
   *  to rdyrct.com's database, bucket and queues on an account that has them. */
  name: string;
  /** Serve the workers.dev address, which wrangler.jsonc turns off. */
  workersDev: boolean;
  /** Drop rdyrct.com's KV and D1 ids so wrangler creates the copy's own. The
   *  Deploy button keeps the ids: it creates the resources and writes them in. */
  dropIds: boolean;
};

/** wrangler.jsonc, comments kept, pointed at `host` (a custom domain or the
 *  worker's workers.dev address) instead of rdyrct.com. */
export function selfHostConfig(source: string, host: string, target: Target): string {
  const changes: [JSONPath, string | boolean | undefined][] = [
    ...resourceNames(source, target.name),
    [["vars", "APP_URL"], `https://${host}`],
    [["vars", "APP_HOST"], host],
    [["workers_dev"], target.workersDev],
    ...RDYRCT_ONLY_VARS.map((name): [JSONPath, undefined] => [["vars", name], undefined]),
  ];
  if (target.dropIds) {
    changes.push(
      [["kv_namespaces", 0, "id"], undefined],
      [["d1_databases", 0, "database_id"], undefined],
    );
  }
  return changes.reduce(
    (text, [path, value]) =>
      applyEdits(text, modify(text, path, value, { formattingOptions: { insertSpaces: true } })),
    source,
  );
}

const Named = v.object({
  name: v.string(),
  r2_buckets: v.array(v.object({ bucket_name: v.string() })),
  d1_databases: v.array(v.object({ database_name: v.string() })),
  queues: v.object({
    producers: v.array(v.object({ queue: v.string() })),
    consumers: v.array(v.object({ queue: v.string(), dead_letter_queue: v.optional(v.string()) })),
  }),
  workflows: v.array(v.object({ name: v.string() })),
});

type Edit = [JSONPath, string];

/** Each top-level resource name, with the config's worker name swapped for
 *  `name` where it leads. The `playwright` environment keeps its own. */
function resourceNames(source: string, name: string): Edit[] {
  const config = v.parse(Named, parse(source));
  const rename = (old: string) =>
    old.startsWith(config.name) ? name + old.slice(config.name.length) : old;
  return [
    [["name"], name],
    ...config.r2_buckets.map((b, i): Edit => [
      ["r2_buckets", i, "bucket_name"],
      rename(b.bucket_name),
    ]),
    ...config.d1_databases.map((d, i): Edit => [
      ["d1_databases", i, "database_name"],
      rename(d.database_name),
    ]),
    ...config.queues.producers.map((q, i): Edit => [
      ["queues", "producers", i, "queue"],
      rename(q.queue),
    ]),
    ...config.queues.consumers.flatMap((q, i): Edit[] => [
      [["queues", "consumers", i, "queue"], rename(q.queue)],
      ...(q.dead_letter_queue
        ? [
            [
              ["queues", "consumers", i, "dead_letter_queue"],
              rename(q.dead_letter_queue),
            ] satisfies Edit,
          ]
        : []),
    ]),
    ...config.workflows.map((w, i): Edit => [["workflows", i, "name"], rename(w.name)]),
  ];
}

/** Every queue the config consumes, the dead-letter one included. */
function queueNames(config: string): string[] {
  return v.parse(Named, parse(config)).queues.consumers.map((q) => q.queue);
}

async function writeConfig(text: string) {
  writeFileSync(WRANGLER, text);
  // Removing a key leaves its neighbour's indent behind, and a copy commits this.
  await $`bun fmt ${WRANGLER.pathname}`.nothrow().quiet();
}

/** `name.subdomain.workers.dev`, when the environment can ask the API for the
 *  account's subdomain. Workers Builds hands wrangler a token and account. */
async function workersDevHost(name: string): Promise<string | undefined> {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!account || !token) return undefined;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`,
    { headers: { authorization: `Bearer ${token}` } },
  ).catch(() => undefined);
  if (!response?.ok) return undefined;
  const body = v.safeParse(
    v.object({ result: v.object({ subdomain: v.string() }) }),
    await response.json(),
  );
  return body.success ? `${name}.${body.output.result.subdomain}.workers.dev` : undefined;
}

/** The secrets this deploy has to add: a session key the first time (never
 *  again, or everyone would be signed out), and the admin when one is given. */
async function newSecrets(admin: string | undefined): Promise<string> {
  const listed = await $`bunx wrangler secret list --format json`.nothrow().quiet();
  const existing = v.safeParse(
    v.array(v.object({ name: v.string() })),
    listed.exitCode === 0 ? JSON.parse(listed.stdout.toString()) : [],
  );
  const names = existing.success ? existing.output.map((secret) => secret.name) : [];
  return [
    names.includes("BETTER_AUTH_SECRET")
      ? ""
      : `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}\n`,
    admin ? `SUPERADMIN_EMAIL=${admin}\n` : "",
  ].join("");
}

/** `wrangler deploy` with whatever secrets are new, returning what it printed
 *  (it prints as it runs too, since wrangler may ask you to log in). */
async function deployWithSecrets(admin?: string, domain?: string): Promise<string> {
  const secrets = await newSecrets(admin);
  const file = ".setup-secrets.env";
  writeFileSync(file, secrets);
  const flags = [
    ...(secrets ? ["--secrets-file", file] : []),
    ...(domain ? ["--domain", domain] : []),
  ];
  const deploy = await $`bunx wrangler deploy ${flags}`.nothrow().finally(() => rmSync(file));
  if (deploy.exitCode !== 0) process.exit(deploy.exitCode);
  return deploy.stdout.toString();
}

/** Build, migrate and deploy a copy whose wrangler.jsonc still describes
 *  rdyrct.com, and return the host it now answers on. */
export async function deploySelfHosted(options: {
  source: string;
  domain?: string;
  admin?: string;
  /** Defaults to the name in `source`. */
  name?: string;
  dropIds: boolean;
}): Promise<string> {
  const { source, domain, dropIds } = options;
  const name = options.name ?? v.parse(Named, parse(source)).name;
  const target = { name, workersDev: !domain, dropIds };
  const known = domain || (await workersDevHost(name));
  const config = selfHostConfig(source, known ?? PENDING_HOST, target);
  await writeConfig(config);

  // Wrangler creates a queue a producer names, not one only a consumer reads,
  // so the dead-letter queue has to exist first. Both fail harmlessly if they do.
  for (const queue of queueNames(config)) {
    await $`bunx wrangler queues create ${queue}`.nothrow().quiet();
  }
  await $`bun run build`;
  // Migrate ahead of an update. Before the first deploy there is no database
  // yet, so this one may fail and the one after the deploy does the work.
  await $`bunx wrangler d1 migrations apply DB --remote`.nothrow();
  const output = await deployWithSecrets(options.admin, domain);
  await $`bunx wrangler d1 migrations apply DB --remote`;
  if (known) return known;

  const host = output.match(/https:\/\/([\w.-]+\.workers\.dev)/)?.[1];
  if (!host) {
    console.error(
      "Deployed, but wrangler printed no workers.dev address. Set APP_URL and APP_HOST in wrangler.jsonc, then run `bun run deploy`.",
    );
    process.exit(1);
  }
  await writeConfig(selfHostConfig(source, host, target));
  // Nothing in the build reads the host, so this deploy needs no rebuild.
  await $`bunx wrangler deploy --var APP_URL:https://${host} --var APP_HOST:${host}`;
  return host;
}

/** Asks for the worker's name and returns it once the account has no worker
 *  by that name, so setup can never deploy over one, rdyrct.com's included.
 *  Any answer but "no such worker" (code 10007) stops it. */
async function freeWorkerName(): Promise<string> {
  const name = (prompt("Name for the worker and its resources:", "rdyrct") ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) {
    console.error("Use lowercase letters, digits and dashes.");
    process.exit(1);
  }
  const check = await $`bunx wrangler deployments list --name ${name} --json`.nothrow().quiet();
  if (check.exitCode === 0) {
    console.error(`Your account already runs a worker named ${name}. Pick another name.`);
    process.exit(1);
  }
  if (!`${check.stdout}${check.stderr}`.includes("10007")) {
    console.error(`Could not check for a worker named ${name}:\n${check.stderr}`);
    process.exit(1);
  }
  return name;
}

if (import.meta.main) {
  const source = readFileSync(WRANGLER, "utf8");
  // pending.workers.dev: an earlier run stopped before it learned the address.
  if (!namesRdyrct(source) && !source.includes(PENDING_HOST)) {
    console.log("This copy is already set up. Ship updates with `bun run deploy`.");
    process.exit(0);
  }

  // A rerun after a stop keeps the name the first run chose and deployed.
  const name = source.includes(PENDING_HOST) ? undefined : await freeWorkerName();
  const domain = prompt(
    "Domain on your Cloudflare account (links.example.com), or Enter for a workers.dev address:",
  )?.trim();
  const admin = prompt("Email of the account that will be the platform admin:")?.trim();
  if (!admin?.includes("@")) {
    console.error("The admin email is required.");
    process.exit(1);
  }

  const host = await deploySelfHosted({ source, domain, admin, name, dropIds: true });
  console.log(`\nDone. Open https://${host}/signup and sign up as ${admin}.`);
  console.log("Commit wrangler.jsonc, then ship updates with `bun run deploy`.");
}
