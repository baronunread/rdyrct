import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { env } from "cloudflare:workers";
import { introspectWorkflowInstance, reset } from "cloudflare:test";
import type { JsonValue } from "../../src/shared/types";
import {
  adminCookie,
  captureBatches,
  applyTestMigrations,
  authEnv,
  fetchWorker,
  jsonBody,
  overrideEnv,
} from "./support";

/**
 * NewsletterSendWorkflow (src/worker/workflows.ts) on the real Workflows
 * binding, driven through the test pool's introspection: the wait for a
 * scheduled time, every batch as its own step, and Cancel. The rules each
 * step applies (who, how far, unsubscribes mid-send) are in
 * marketing.worker.ts, which calls the steps one by one.
 */

beforeEach(applyTestMigrations);
afterEach(() => reset());

/** The worker with the real workflow binding, not the stub. */
const realWorkflow = () => overrideEnv({ ...authEnv(), NEWSLETTER_SEND: env.NEWSLETTER_SEND });

const post = (cookie: string, path: string, body?: JsonValue) =>
  fetchWorker(
    new Request(`http://localhost/api/admin/newsletter${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    realWorkflow(),
  );

const issue = {
  list: "news",
  subject: "Scheduled issue",
  doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] },
};

const seedReaders = (n: number) =>
  env.DB.batch(
    Array.from({ length: n }, (_, i) => {
      const id = `w${String(i).padStart(3, "0")}`;
      return env.DB.prepare(
        `insert into user (id, name, email, email_verified, banned, news_opt_in_at, news_opt_in_source, created_at, updated_at)
         values (?, ?, ?, 1, 0, 5, 'settings', 0, 0)`,
      ).bind(id, id, `${id}@example.com`);
    }),
  );

const row = (id: string) =>
  env.DB.prepare(
    "select status, sent, scheduled_for as scheduledFor from newsletter_sends where id = ?",
  )
    .bind(id)
    .first<{ status: string; sent: number; scheduledFor: number | null }>();

describe("the newsletter send workflow", () => {
  it("waits for a scheduled time, and Cancel stops it before anyone gets it", async () => {
    const cookie = await adminCookie();
    await seedReaders(3);
    const at = Date.now() + 60 * 60 * 1000;
    await using instance = await introspectWorkflowInstance(env.NEWSLETTER_SEND, "send-later");
    const res = await post(cookie, "/send", { ...issue, sendId: "send-later", scheduledFor: at });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      id: "send-later",
      status: "scheduled",
      scheduledFor: at,
    });

    // It read when to go, and sleeps until then: still running (a local
    // sleep reports as running), the row untouched, nobody sent to.
    expect(await instance.waitForStepResult({ name: "load" })).toBe(at);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const live = await env.NEWSLETTER_SEND.get("send-later");
    expect((await live.status()).status).toBe("running");
    expect(await row("send-later")).toEqual({ status: "scheduled", sent: 0, scheduledFor: at });

    const history = await jsonBody<{ sends: { id: string; status: string }[] }>(
      await fetchWorker(
        new Request("http://localhost/api/admin/newsletter", { headers: { cookie } }),
        realWorkflow(),
      ),
    );
    expect(history.sends[0]).toMatchObject({ id: "send-later", status: "scheduled" });

    const cancelled = await post(cookie, "/sends/send-later/cancel");
    expect(cancelled.status).toBe(200);
    expect(await jsonBody(cancelled)).toMatchObject({ status: "cancelled" });
    await instance.waitForStatus("terminated");
    expect(await row("send-later")).toMatchObject({ status: "cancelled", sent: 0 });
    // Once cancelled, there is nothing left to cancel.
    expect((await post(cookie, "/sends/send-later/cancel")).status).toBe(409);
  });

  it("sends at its time, every batch of 100 picked and delivered in steps of its own", async () => {
    const mail = captureBatches();
    const cookie = await adminCookie();
    await seedReaders(150);
    const at = Date.now() + 60 * 60 * 1000;
    await using instance = await introspectWorkflowInstance(env.NEWSLETTER_SEND, "send-batches");
    // The hour passes at once.
    await instance.modify(async (m) => {
      await m.disableSleeps();
    });
    expect(
      (await post(cookie, "/send", { ...issue, sendId: "send-batches", scheduledFor: at })).status,
    ).toBe(200);

    await instance.waitForStatus("complete");
    const picked = await instance.waitForStepResult({ name: "pick-0" });
    expect(Array.isArray(picked) && picked.length).toBe(100);
    expect(await instance.waitForStepResult({ name: "batch-0" })).toBe(100);
    expect(await instance.waitForStepResult({ name: "batch-1" })).toBe(50);
    // The third pick finds nobody, so there is no third delivery.
    expect(await instance.waitForStepResult({ name: "pick-2" })).toEqual([]);
    expect(await row("send-batches")).toMatchObject({ status: "sent", sent: 150 });
    const reached = mail.batches.flatMap((b) => b.emails.map((e) => e.to[0]));
    expect(reached).toHaveLength(150);
    expect(new Set(reached).size).toBe(150);
    mail.restore();
  });
});
