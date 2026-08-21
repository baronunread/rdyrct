/**
 * Spike for issue #95, step 1: stand up a whole rdyrct stage from TypeScript,
 * run the browser suite against it, tear it down. Nothing here touches
 * production. `wrangler.jsonc` stays the source of truth until this is proven.
 *
 * Physical names come out as `rdyrct-<id>-<stage>`, so `--stage pr-92` gets its
 * own D1, KV, R2 bucket, four queues, two workflows and Worker. Run:
 *
 *   bun run build
 *   bunx alchemy deploy  --stage pr-92
 *   bunx alchemy destroy --stage pr-92
 *
 * Pinned to alchemy 0.94.0 on purpose: v2 is a beta that shipped twice in one
 * hour and drags Effect v4 (itself an RC) in as the programming model. The
 * spike only has to answer "does a stage stand up, and does teardown leak".
 */
import alchemy from "alchemy";
import {
  Assets,
  D1Database,
  KVNamespace,
  Queue,
  R2Bucket,
  RateLimit,
  Worker,
  Workflow,
} from "alchemy/cloudflare";

const app = await alchemy("rdyrct");

const stageUrl = process.env.STAGE_URL ?? "https://example.invalid";

const db = await D1Database("db", { migrationsDir: "migrations" });
const links = await KVNamespace("links", {});
const qrLogos = await R2Bucket("qr-logos", {});

const storage = await Queue("storage", {});
const storageDlq = await Queue("storage-dlq", {});
const clicks = await Queue("clicks", {});
const clicksDlq = await Queue("clicks-dlq", {});

// Namespace ids are per-Worker-script binding config, and every stage gets its
// own script, so the production numbers can be reused verbatim. Limits are the
// e2e ones from env.playwright, not production's: a browser suite running from
// one address shares one budget.
const rl = (namespace_id: number, limit: number) =>
  RateLimit({ namespace_id, simple: { limit, period: 60 } });

const rateLimits = {
  RL_AUTH_PUBLIC: rl(14001, 40),
  RL_CAP: rl(14011, 600),
  RL_EMAIL: rl(14002, 30),
  RL_WRITE_FREE: rl(14003, 90),
  RL_WRITE_PAID: rl(14004, 300),
  RL_QR_UPLOAD: rl(14005, 20),
  RL_DOMAIN_SETUP: rl(14006, 30),
  RL_BILLING: rl(14007, 10),
  RL_CLICK_RECORDING: rl(14008, 600),
  RL_EMAIL_RECIPIENT: rl(14009, 5),
  RL_ANON_LINK: rl(14010, 30),
};

export const worker = await Worker("api", {
  entrypoint: "src/worker/index.ts",
  compatibilityDate: "2026-01-01",
  compatibilityFlags: ["nodejs_compat"],
  crons: ["0 6 * * *"],
  assets: {
    not_found_handling: "single-page-application",
    // The negation globs wrangler.jsonc carries, passed through verbatim. The
    // open question on #95 was whether Alchemy accepts them: the prop is
    // `boolean | string[]` and goes straight to the API, so it does.
    run_worker_first: [
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
  eventSources: [
    {
      queue: storage,
      settings: {
        batchSize: 10,
        maxWaitTimeMs: 5000,
        maxRetries: 5,
        retryDelay: 30,
        deadLetterQueue: storageDlq,
      },
    },
    {
      queue: storageDlq,
      settings: { batchSize: 10, maxWaitTimeMs: 5000, maxRetries: 3, retryDelay: 30 },
    },
    {
      queue: clicks,
      settings: {
        batchSize: 100,
        maxWaitTimeMs: 5000,
        maxRetries: 5,
        retryDelay: 30,
        deadLetterQueue: clicksDlq,
      },
    },
    {
      queue: clicksDlq,
      settings: { batchSize: 100, maxWaitTimeMs: 5000, maxRetries: 3, retryDelay: 30 },
    },
  ],
  bindings: {
    DB: db,
    LINKS: links,
    QR_LOGOS: qrLogos,
    ASSETS: await Assets({ path: "dist/client" }),
    STORAGE_QUEUE: storage,
    CLICK_QUEUE: clicks,
    ORG_DELETE: Workflow("org-delete", { className: "OrgDeleteWorkflow" }),
    DOMAIN_ACTIVATE: Workflow("domain-activate", { className: "DomainActivateWorkflow" }),
    ...rateLimits,

    APP_URL: stageUrl,
    APP_HOST: new URL(stageUrl).host,
    MAIL_FROM: "rdyrct <no-reply@mail.rdyrct.com>",
    POLAR_SERVER: "sandbox",
    POLAR_PRO_PRODUCT_ID: process.env.POLAR_PRO_PRODUCT_ID ?? "",
    POLAR_HOBBY_PRODUCT_ID: process.env.POLAR_HOBBY_PRODUCT_ID ?? "",
    CF_ZONE_ID: "",
    // ponytail: no CF_API_TOKEN on a stage, so custom-domain calls fail closed.
    // "instant" is what the e2e run uses; a stage that has to prove real
    // custom hostnames needs the v2 CustomHostname resource, which 0.94.0
    // does not have.
    CF_DEV_ENV: "instant",
    SENTRY_DSN: "",
    RESEND_BASE_URL: process.env.RESEND_BASE_URL ?? "",

    BETTER_AUTH_SECRET: alchemy.secret.env.BETTER_AUTH_SECRET,
    SUPERADMIN_EMAIL: alchemy.secret.env.SUPERADMIN_EMAIL,
    RESEND_API_KEY: alchemy.secret.env.RESEND_API_KEY,
    POLAR_ACCESS_TOKEN: alchemy.secret.env.POLAR_ACCESS_TOKEN,
    POLAR_WEBHOOK_SECRET: alchemy.secret.env.POLAR_WEBHOOK_SECRET,
    CAP_SECRET: alchemy.secret.env.CAP_SECRET,
  },
});

console.log(worker.url);

await app.finalize();
