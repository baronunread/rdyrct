/**
 * Rewrites the copy's wrangler.jsonc (rdyrct.com's resource ids, domain, Polar products, Sentry) into a self-hosted one;
 * wrangler provisions bindings with no id on first deploy. `deploySelfHosted` is also what the Deploy button runs.
 */
import { $ } from "bun";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { applyEdits, modify, parse, type JSONPath } from "jsonc-parser";
import * as v from "valibot";
import { namesRdyrct } from "./site-mode";

const WRANGLER = new URL("../wrangler.jsonc", import.meta.url);

/** Until the worker exists its workers.dev address may be unknown: the first deploy carries this, a second replaces it. */
const PENDING_HOST = "pending.workers.dev";

/** A copy that kept ours would send its mail as us and bill against our Polar products. */
const RDYRCT_ONLY_VARS = [
  "MAIL_FROM",
  "WELCOME_FROM",
  "NEWSLETTER_FROM",
  "NEWSLETTER_REPLY_TO",
  "POSTAL_ADDRESS",
  "POLAR_SERVER",
  "POLAR_PRO_PRODUCT_ID",
  "POLAR_HOBBY_PRODUCT_ID",
  "POLAR_PRO_YEARLY_PRODUCT_ID",
  "POLAR_HOBBY_YEARLY_PRODUCT_ID",
  "CF_ZONE_ID",
];

type Target = {
  /** Every resource is named after it, and Wrangler finds a resource with no id by name: a copy that kept ours
   * would bind to rdyrct.com's database on an account that has them. */
  name: string;
  workersDev: boolean;
  /** The Deploy button keeps the ids: it creates the resources and writes them in. */
  dropIds: boolean;
};

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

function queueNames(config: string): string[] {
  return v.parse(Named, parse(config)).queues.consumers.map((q) => q.queue);
}

/** A failed listing throws, so an update never skips its migration because the API was down. */
async function databaseExists(config: string): Promise<boolean> {
  const wanted = v.parse(Named, parse(config)).d1_databases.map((d) => d.database_name);
  const listed = v.parse(
    v.array(v.object({ name: v.string() })),
    JSON.parse(await $`bunx wrangler d1 list --json`.quiet().text()),
  );
  return listed.some((d) => wanted.includes(d.name));
}

async function writeConfig(text: string) {
  writeFileSync(WRANGLER, text);
  // Removing a key leaves its neighbour's indent behind, and a copy commits this.
  await $`bun fmt ${WRANGLER.pathname}`.nothrow().quiet();
}

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

/** A session key only the first time: never again, or everyone is signed out. */
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

export async function deploySelfHosted(options: {
  source: string;
  domain?: string;
  admin?: string;
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
  // Migrate ahead of an update, and stop if that fails: new code must not
  // meet an old schema. Before the first deploy there is no database yet, so
  // there is nothing to migrate and the run after the deploy does the work.
  if (await databaseExists(config)) await $`bunx wrangler d1 migrations apply DB --remote`;
  const output = await deployWithSecrets(options.admin, domain);
  await $`bunx wrangler d1 migrations apply DB --remote`;
  if (known) return known;

  const host = deployedHost(output);
  if (!host) {
    console.error(
      "Deployed, but wrangler printed no workers.dev address. Set APP_URL and APP_HOST in wrangler.jsonc, then run `bun run deploy`.",
    );
    process.exit(1);
  }
  await writeConfig(selfHostConfig(source, host, target));
  await $`bunx wrangler deploy --var APP_URL:https://${host} --var APP_HOST:${host}`;
  return host;
}

/** Its output lists the vars first, with APP_URL still the placeholder: skip that one. */
export function deployedHost(output: string): string | undefined {
  return [...output.matchAll(/https:\/\/([\w.-]+\.workers\.dev)/g)]
    .map((match) => match[1])
    .find((host) => host !== PENDING_HOST);
}

/** Any answer but "no such worker" (code 10007) stops it: setup never deploys over a worker, rdyrct.com's included. */
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
