import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Env } from "./env";
import {
  deleteKvKeys,
  deleteR2Prefix,
  enqueueStorage,
  orgDeleteGather,
  syncDomainMsg,
} from "./storage";
import { finishImport, importNextChunk, stopImport } from "./routes/link-import";
import {
  MAX_BATCHES,
  beginSend,
  deliverPicked,
  finishSend,
  pickBatch,
  sendTime,
} from "./newsletter-send";
import { createError } from "evlog";
import { cfDeleteHostname, ensureHostname, probeDelaySeconds, probeDomain } from "./routes/domains";

interface OrgDeleteParams {
  orgId: string;
}

interface DomainActivateParams {
  domainId: string;
  hostname: string;
}

/**
 * Steps run in order: gather -> delete org row (D1) -> Cloudflare hostnames -> KV -> R2.
 * Each is retried on its own and safe to run twice. The D1 delete comes right
 * after gather so reconciliation already agrees the org's KV/R2 data should go.
 */
export class OrgDeleteWorkflow extends WorkflowEntrypoint<Env, OrgDeleteParams> {
  async run(event: Readonly<WorkflowEvent<OrgDeleteParams>>, step: WorkflowStep): Promise<void> {
    const { orgId } = event.payload;

    const gathered = await step.do("gather", async () => {
      const db = drizzle(this.env.DB, { schema });
      return orgDeleteGather(db, orgId);
    });

    await step.do("d1-delete", async () => {
      const db = drizzle(this.env.DB, { schema });
      await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    });

    await step.do("cf-hostnames", async () => {
      // Each delete tolerates an already-gone hostname, so a step retry is safe.
      await Promise.all(
        gathered.cfHostnameIds.map((cfHostnameId) => cfDeleteHostname(this.env, cfHostnameId)),
      );
    });

    await step.do("kv-delete", () => deleteKvKeys(this.env, gathered.kvKeys));

    await step.do("r2-prefix", () => deleteR2Prefix(this.env, `${orgId}/`));
  }
}

/**
 * Steps: ensure-hostname (get-or-create, so a retry never duplicates a custom
 * hostname) -> probe (loop, DNS then TLS, 24h deadline then `error`) -> publish-kv.
 * `step.sleep` between probes does not count toward the step limit.
 */
export class DomainActivateWorkflow extends WorkflowEntrypoint<Env, DomainActivateParams> {
  async run(
    event: Readonly<WorkflowEvent<DomainActivateParams>>,
    step: WorkflowStep,
  ): Promise<void> {
    const { domainId, hostname } = event.payload;

    const ensured = await step.do("ensure-hostname", () =>
      ensureHostname(this.env, domainId, hostname),
    );
    if (ensured === null) return;

    for (let attempt = 0; ; attempt++) {
      const probe = await step.do(`probe-${attempt}`, () => probeDomain(this.env, domainId));
      if (probe.state === "gone" || probe.state === "error") return;
      if (probe.state === "active") {
        await step.do("publish-kv", () => enqueueStorage(this.env, [syncDomainMsg(hostname)]));
        return;
      }
      await step.sleep(`wait-${attempt}`, `${probeDelaySeconds(attempt)} seconds`);
    }
  }
}

/** Each step writes one chunk and records outcomes, so a resumed step never writes a row twice (#383). */
export class LinkImportWorkflow extends WorkflowEntrypoint<Env, { importId: string }> {
  async run(
    event: Readonly<WorkflowEvent<{ importId: string }>>,
    step: WorkflowStep,
  ): Promise<void> {
    const { importId } = event.payload;
    try {
      for (let chunk = 0; ; chunk++) {
        const pending = await step.do(`chunk-${chunk}`, () => importNextChunk(this.env, importId));
        if (pending === 0) break;
      }
    } catch (err) {
      // A step that failed every retry: end the import, or it blocks the org's next one.
      await step.do("give up", () => stopImport(this.env, importId));
      throw err;
    }
    await step.do("finish", () => finishImport(this.env, importId));
  }
}

const BATCH_RETRIES = {
  retries: { limit: 6, delay: "10 seconds", backoff: "exponential" },
} as const;

/**
 * Each batch is two steps: `pick-n` freezes who gets it (a retry never reads again) and
 * `batch-n` delivers under one provider key. Steps are capped (MAX_BATCHES in
 * newsletter-send.ts). `start` finds the row cancelled if the instance outlives a cancel.
 */
export class NewsletterSendWorkflow extends WorkflowEntrypoint<Env, { sendId: string }> {
  async run(event: Readonly<WorkflowEvent<{ sendId: string }>>, step: WorkflowStep): Promise<void> {
    const { sendId } = event.payload;
    const at = await step.do("load", () => sendTime(this.env, sendId));
    if (at === null) return;
    if (at > 0) await step.sleepUntil("wait", at);
    const startedAt = await step.do("start", () => beginSend(this.env, sendId));
    if (startedAt === null) return;
    try {
      for (let batch = 0; ; batch++) {
        const people = await step.do(`pick-${batch}`, () => pickBatch(this.env, sendId, startedAt));
        if (people.length === 0) break;
        if (batch >= MAX_BATCHES) {
          throw createError({
            message: "The send reached the Workflows step limit",
            status: 500,
            why: `More than ${MAX_BATCHES} batches; the audience grew after the send was accepted`,
            fix: "Narrow the filters and send the rest as a new send",
          });
        }
        await step.do(`batch-${batch}`, BATCH_RETRIES, () =>
          deliverPicked(this.env, sendId, batch, people, startedAt),
        );
      }
    } catch (err) {
      // A batch that failed every retry: end the send as failed rather than show sending forever.
      await step.do("give up", () => finishSend(this.env, sendId, "failed"));
      throw err;
    }
    await step.do("finish", () => finishSend(this.env, sendId, "sent"));
  }
}
