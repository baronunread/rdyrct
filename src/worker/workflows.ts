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
import { cfDeleteHostname, ensureHostname, probeDelaySeconds, probeDomain } from "./routes/domains";

interface OrgDeleteParams {
  orgId: string;
}

interface DomainActivateParams {
  domainId: string;
  hostname: string;
}

/**
 * Org teardown as a durable, multi-step process. Once the request handler
 * creates an instance, Cloudflare Workflows runs every step to completion and
 * retries each one on its own, so a KV or R2 outage cannot leave the teardown
 * half done. The steps run in this order:
 *
 *   gather -> delete the org row (D1) -> Cloudflare hostnames -> KV -> R2
 *
 * The D1 delete comes right after gather so the rest of the system (including
 * reconciliation) already agrees the org's KV/R2 data should go. Every step is
 * safe to run more than once.
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
      // Foreign-key cascades remove the org's links, domains, members, invites.
      await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    });

    await step.do("cf-hostnames", async () => {
      // Each delete tolerates an already-gone hostname, so a step retry that
      // re-runs this callback after a partial failure is still safe.
      await Promise.all(
        gathered.cfHostnameIds.map((cfHostnameId) => cfDeleteHostname(this.env, cfHostnameId)),
      );
    });

    await step.do("kv-delete", () => deleteKvKeys(this.env, gathered.kvKeys));

    await step.do("r2-prefix", () => deleteR2Prefix(this.env, `${orgId}/`));
  }
}

/**
 * Custom-domain activation as a durable, resumable process. Domain creation
 * commits the D1 row and creates one instance keyed by the row id, then returns.
 * The workflow does every external step off the request path and resumes safely
 * after a Worker or provider failure. The steps run in this order:
 *
 *   ensure-hostname -> probe (loop, DNS then TLS) -> publish-kv
 *
 * `ensure-hostname` is get-or-create, so a retry never makes a duplicate custom
 * hostname (see ensureHostname). Each `probe` advances the D1 status one step
 * and is idempotent; `step.sleep` between probes backs off and does not count
 * toward the step limit. A domain that never resolves lands in `error` (a probe
 * enforces a 24h deadline) instead of polling forever. `publish-kv` is a
 * separate step so a failed KV publish retries without re-running the probes.
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
    // null means the domain row was deleted while we set up: nothing to activate.
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
