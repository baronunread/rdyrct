/**
 * Spike for issue #95, step 1: stand up a whole rdyrct stage from TypeScript,
 * run the browser suite against it, tear it down. Nothing here touches
 * production. `wrangler.jsonc` stays the source of truth until this is proven.
 *
 * Physical names come out `rdyrct-<stage>-<id>`, so `--stage pr-92` gets its
 * own D1, KV, R2 bucket, four queues, two workflows and Worker. Run:
 *
 *   bun run build
 *   bunx alchemy deploy  --stage pr-92
 *   bunx alchemy destroy --stage pr-92
 *
 * Pinned to alchemy 2.0.0-beta.74 and effect 4.0.0-rc.111, both exact: v2
 * shipped twice in one hour on the day this was written, and Effect is still
 * an RC. Only this file is written in Effect. The Worker itself stays a plain
 * async Worker (`export default { fetch }`), which is what v2 calls the
 * non-Effect style, so nothing under src/ changes.
 */
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

const stageUrl = process.env.STAGE_URL ?? "https://example.invalid";

/**
 * The counters from wrangler.jsonc, at the e2e limits rather than the
 * production ones: a browser suite runs from one address, so every test shares
 * one budget.
 *
 * The ids are their own block (34xxx), not production's 14xxx, for the same
 * reason env.playwright uses 24xxx: wrangler.jsonc says namespace ids are
 * unique within the account, and neither Cloudflare's docs nor Alchemy's
 * source says whether a counter is scoped to the script or to the account. A
 * distinct block costs nothing and settles the question by not asking it. One
 * more reason a stage cannot reach production.
 */
const rateLimits = {
  RL_AUTH_PUBLIC: [34001, 40],
  RL_CAP: [34011, 600],
  RL_EMAIL: [34002, 30],
  RL_WRITE_FREE: [34003, 90],
  RL_WRITE_PAID: [34004, 300],
  RL_QR_UPLOAD: [34005, 20],
  RL_DOMAIN_SETUP: [34006, 30],
  RL_BILLING: [34007, 10],
  RL_CLICK_RECORDING: [34008, 600],
  RL_EMAIL_RECIPIENT: [34009, 5],
  RL_ANON_LINK: [34010, 30],
} as const;

const limits = Object.fromEntries(
  Object.entries(rateLimits).map(([name, [namespaceId, limit]]) => [
    name,
    Cloudflare.RateLimit(name, { namespaceId, simple: { limit, period: 60 } }),
  ]),
);

export default Alchemy.Stack(
  "rdyrct",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const db = yield* Cloudflare.D1.Database("db", { migrations: "migrations" });
    const links = yield* Cloudflare.KV.Namespace("links");
    const qrLogos = yield* Cloudflare.R2.Bucket("qr-logos");

    const storage = yield* Cloudflare.Queues.Queue("storage");
    const storageDlq = yield* Cloudflare.Queues.Queue("storage-dlq");
    const clicks = yield* Cloudflare.Queues.Queue("clicks");
    const clicksDlq = yield* Cloudflare.Queues.Queue("clicks-dlq");

    const worker = yield* Cloudflare.Worker("api", {
      // The Vite build's output, not the TypeScript entry: Alchemy bundles
      // `main` with rolldown, and its `build` option exposes only rolldown's
      // output options, so there is no way to hand it the two resolve aliases
      // this repo needs. Without them the bundle fails on `@/shared/types` and
      // drags in the 5 MB javascript-obfuscator chunk that
      // cap-unused-dep-stub.ts exists to keep out (see vite.config.ts).
      //
      // `bundle: false` uploads dist/rdyrct/index.js and its sibling chunks
      // byte-for-byte instead, which is also the build the production Worker
      // runs, so a stage and production execute the same output. The default
      // module rules cover the `assets/*.js` chunks and skip the wrangler.json
      // and .dev.vars that Vite writes next to them.
      main: "dist/rdyrct/index.js",
      bundle: false,
      compatibility: { date: "2026-01-01", flags: ["nodejs_compat"] },
      crons: ["0 6 * * *"],
      workersDev: true,
      assets: {
        directory: "dist/client",
        notFoundHandling: "single-page-application",
        // The negation globs wrangler.jsonc carries, unchanged. Open point 1
        // on #95 asked whether Alchemy takes them: `runWorkerFirst` is
        // `boolean | string[]` and documents negative rules, so it does.
        runWorkerFirst: [
          "/*",
          "!/assets/*",
          "!/favicon.svg",
          "!/og.png",
          "!/robots.txt",
          "!/sitemap.xml",
          "!/llms.txt",
          "!/llms-full.txt",
          "!/ai.txt",
          "!/pricing.md",
        ],
      },
      env: {
        DB: db,
        LINKS: links,
        QR_LOGOS: qrLogos,
        STORAGE_QUEUE: storage,
        CLICK_QUEUE: clicks,
        ORG_DELETE: Cloudflare.Workflow("ORG_DELETE", { className: "OrgDeleteWorkflow" }),
        DOMAIN_ACTIVATE: Cloudflare.Workflow("DOMAIN_ACTIVATE", {
          className: "DomainActivateWorkflow",
        }),
        ...limits,

        APP_URL: stageUrl,
        APP_HOST: new URL(stageUrl).host,
        MAIL_FROM: "rdyrct <no-reply@mail.rdyrct.com>",
        POLAR_SERVER: "sandbox",
        POLAR_PRO_PRODUCT_ID: process.env.POLAR_PRO_PRODUCT_ID ?? "",
        POLAR_HOBBY_PRODUCT_ID: process.env.POLAR_HOBBY_PRODUCT_ID ?? "",
        // A stage gets no CF_API_TOKEN, so custom-domain calls fail closed and
        // "instant" reports activation done, same as the local e2e run. v2 does
        // have CustomHostname and FallbackOrigin resources, so a stage that has
        // to prove real custom domains is possible. It is not this one.
        CF_ZONE_ID: "",
        CF_DEV_ENV: "instant",
        SENTRY_DSN: "",
        RESEND_BASE_URL: process.env.RESEND_BASE_URL ?? "",

        BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
        SUPERADMIN_EMAIL: Config.redacted("SUPERADMIN_EMAIL"),
        RESEND_API_KEY: Config.redacted("RESEND_API_KEY"),
        POLAR_ACCESS_TOKEN: Config.redacted("POLAR_ACCESS_TOKEN"),
        POLAR_WEBHOOK_SECRET: Config.redacted("POLAR_WEBHOOK_SECRET"),
        CAP_SECRET: Config.redacted("CAP_SECRET"),
      },
    });

    // A plain async Worker exports its own `queue()` handler, so the consumers
    // are declared here rather than inferred. Batch sizes, retries and delays
    // are wrangler.jsonc's, and max_retries still has to match
    // STORAGE_MAX_DELIVERIES (storage.ts) and CLICK_MAX_DELIVERIES (clicks.ts).
    const consume = (
      id: string,
      queue: Cloudflare.Queues.Queue,
      settings: { batchSize: number; maxRetries: number },
      dlq?: Cloudflare.Queues.Queue,
    ) =>
      Cloudflare.Queues.Consumer(id, {
        queueId: queue.queueId,
        scriptName: worker.workerName,
        deadLetterQueue: dlq?.queueName,
        settings: { ...settings, maxWaitTimeMs: 5000, retryDelay: 30 },
      });

    yield* consume("storage-consumer", storage, { batchSize: 10, maxRetries: 5 }, storageDlq);
    yield* consume("storage-dlq-consumer", storageDlq, { batchSize: 10, maxRetries: 3 });
    yield* consume("clicks-consumer", clicks, { batchSize: 100, maxRetries: 5 }, clicksDlq);
    yield* consume("clicks-dlq-consumer", clicksDlq, { batchSize: 100, maxRetries: 3 });

    return { url: worker.url };
  }),
);
