/**
 * A newsletter send, from the admin's Send now or Schedule to the last batch.
 *
 * The request stores the issue on a `newsletter_sends` row and starts a
 * NewsletterSendWorkflow instance with the same id (workflows.ts). The
 * workflow waits until the scheduled time, if there is one, then goes
 * batch by batch, BATCH_SIZE people at a time, until nobody is left. Each
 * batch is two steps: one picks who (and Workflows keeps that list), one
 * delivers to exactly that list. Every piece of that is a function here, so
 * the worker tests can drive each step the way the workflow does.
 *
 * Who gets it is decided in marketing.ts, read fresh for every batch and
 * checked again just before a batch goes, so somebody who unsubscribes or
 * leaves the filters while it runs is left out of what has not gone yet. How it is delivered is newsletter.ts, the only
 * file that knows the provider.
 */
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createError, createLogger } from "evlog";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { countOptedIn, optedInRecipients, sameAudience, stillReachable } from "./marketing";
import {
  BATCH_SIZE,
  deliverBatch,
  newsletterSender,
  type Issue,
  type Recipient,
} from "./newsletter";
import { docToBlocks } from "./newsletter-doc";
import type { NewsletterSendState } from "@/shared/types";

type SendRow = typeof schema.newsletterSends.$inferSelect;

/** What the composer hands over: the issue, who, and when (null for now). */
export type NewSend = Pick<
  SendRow,
  "id" | "list" | "audience" | "subject" | "doc" | "sentBy" | "scheduledFor"
>;

/**
 * Cloudflare Workflows allows 10,000 steps per instance on Workers Paid
 * (1,024 on Free; step.sleep does not count), per
 * https://developers.cloudflare.com/workflows/reference/limits/ as of
 * November 2026. A send takes 4 steps of its own (load, start, the last
 * pick that finds nobody, then finish or give up) and 2 per batch of
 * BATCH_SIZE (pick, deliver): 4,998 batches, 499,800 people. A bigger
 * audience is refused before it starts rather than cut off part way. On
 * Workers Free the cap is 1,024 steps, about 51,000 people.
 */
const STEP_LIMIT = 10_000;
const OWN_STEPS = 4;
export const MAX_BATCHES = Math.floor((STEP_LIMIT - OWN_STEPS) / 2);
const MAX_RECIPIENTS = MAX_BATCHES * BATCH_SIZE;

const dbOf = (env: Env) => drizzle(env.DB, { schema });

function issueOf(row: SendRow): Issue {
  return { list: row.list, subject: row.subject, blocks: docToBlocks(row.doc) };
}

async function sendRow(db: DB, id: string): Promise<SendRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.newsletterSends)
    .where(eq(schema.newsletterSends.id, id));
  return row;
}

/** The same send id twice is a double click or a retry, and gets the first
 * one's state back. A send id already used for another list or other filters
 * is refused: going on with it would mix two audiences. So is one used for
 * another subject, body or time: the retry would answer "sent" while the
 * edit never went anywhere. */
function checkRepeat(earlier: SendRow, send: NewSend) {
  if (earlier.list !== send.list || !sameAudience(earlier.audience, send.audience)) {
    throw createError({
      message: "This send already went to another audience",
      status: 409,
      why: `Send ${send.id} started on ${earlier.list} ${JSON.stringify(earlier.audience)}`,
      fix: "Reload the page to start a new send",
    });
  }
  const sameContent =
    earlier.subject === send.subject &&
    JSON.stringify(earlier.doc) === JSON.stringify(send.doc) &&
    (earlier.scheduledFor?.getTime() ?? null) === (send.scheduledFor?.getTime() ?? null);
  if (sameContent) return;
  throw createError({
    message: "This send already went with different content; start a new one",
    status: 409,
    why: `Send ${send.id} was stored with another subject, body or time`,
    fix: "Reload the page to start a new send",
  });
}

/** Refuses an audience bigger than one workflow can reach (MAX_BATCHES). */
function checkSize(count: number) {
  if (count <= MAX_RECIPIENTS) return;
  throw createError({
    message: `This audience is too big for one send: at most ${MAX_RECIPIENTS.toLocaleString("en-US")} people`,
    status: 409,
    why: `${count} people match, and Cloudflare Workflows allows ${STEP_LIMIT} steps per send`,
    fix: "Narrow the filters, or split the send",
  });
}

/** Starts the workflow for a stored send. A repeat only starts one when
 * none runs (the first request stopped between storing and starting). A
 * start that fails marks the send failed, so it never shows as sending for
 * good. */
async function ensureWorkflow(env: Env, db: DB, id: string, repeat: boolean) {
  if (repeat) {
    const exists = await env.NEWSLETTER_SEND.get(id).then(
      () => true,
      () => false,
    );
    if (exists) return;
  }
  try {
    await env.NEWSLETTER_SEND.create({ id, params: { sendId: id } });
  } catch (error) {
    await db
      .update(schema.newsletterSends)
      .set({ status: "failed", finishedAt: new Date() })
      .where(eq(schema.newsletterSends.id, id));
    throw createError({
      message: "The send could not start",
      status: 502,
      why: "Cloudflare Workflows refused to start the send",
      fix: "Try again in a minute",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Stores the send and starts its workflow. Send now refuses an audience
 * nobody is in; a scheduled send is let through, because people may opt in
 * before it goes.
 */
export async function startSend(env: Env, send: NewSend): Promise<NewsletterSendState> {
  // Refused before anything is stored when this instance cannot send.
  newsletterSender(env);
  const db = dbOf(env);
  const earlier = await sendRow(db, send.id);
  if (earlier) {
    checkRepeat(earlier, send);
    if (earlier.status === "scheduled" || earlier.status === "sending")
      await ensureWorkflow(env, db, send.id, true);
    return stateOf(earlier);
  }
  const reach = await countOptedIn(db, send.list, send.audience);
  checkSize(reach);
  if (!send.scheduledFor && !reach) {
    throw createError({
      message: "Nobody on this list matches, so there is nobody to send to",
      status: 409,
      why: `No verified, unbanned account on ${send.list} matches ${JSON.stringify(send.audience)}`,
      fix: "Loosen the filters, or wait for more people to opt in",
    });
  }
  const [row] = await db
    .insert(schema.newsletterSends)
    .values({
      ...send,
      createdAt: new Date(),
      status: send.scheduledFor ? "scheduled" : "sending",
    })
    .returning();
  await ensureWorkflow(env, db, send.id, false);
  return stateOf(row);
}

function stateOf(row: SendRow): NewsletterSendState {
  return { id: row.id, status: row.status, scheduledFor: row.scheduledFor?.getTime() ?? null };
}

/** The workflow's first step: when to send, as epoch ms (0 for now), or null
 * when there is nothing to send (cancelled before it began, or gone). */
export async function sendTime(env: Env, id: string): Promise<number | null> {
  const row = await sendRow(dbOf(env), id);
  if (!row || (row.status !== "scheduled" && row.status !== "sending")) return null;
  return row.scheduledFor?.getTime() ?? 0;
}

/** After the wait: the send is under way. Returns the moment it began, which
 * every batch uses to tell active from slipping away, or null when it was
 * cancelled meanwhile. */
export async function beginSend(env: Env, id: string): Promise<number | null> {
  const [row] = await dbOf(env)
    .update(schema.newsletterSends)
    .set({ status: "sending" })
    .where(
      and(
        eq(schema.newsletterSends.id, id),
        inArray(schema.newsletterSends.status, ["scheduled", "sending"]),
      ),
    )
    .returning({ id: schema.newsletterSends.id });
  return row ? Date.now() : null;
}

/**
 * The next BATCH_SIZE people after the cursor, as the workflow's `pick-n`
 * step. Workflows keeps a step's result, so a retried delivery reuses this
 * exact list rather than reading again: that is what lets one provider key
 * stand for one batch. Empty means nobody is left, or the send is no longer
 * sending.
 */
export async function pickBatch(env: Env, id: string, startedAt: number): Promise<Recipient[]> {
  const db = dbOf(env);
  const row = await sendRow(db, id);
  if (!row || row.status !== "sending") return [];
  return optedInRecipients(db, row.list, BATCH_SIZE, {
    after: row.cursor,
    filter: row.audience,
    now: startedAt,
  });
}

/**
 * Sends batch `n`, the list `pickBatch` froze, as the workflow's `batch-n`
 * step, and moves the cursor to its last id. Returns how many it sent.
 *
 * Consent is read again first: somebody who unsubscribed (or left the
 * filters) since the pick is dropped, and the key stays the same. The key is
 * the send id and the batch number, so a retry that already reached the
 * provider sends nothing twice, even with somebody dropped (the provider
 * answers 409, which counts as sent). The cursor only moves forward, so a
 * retry never counts a batch twice. Somebody who joins with an id inside a
 * batch already picked is not in its frozen list, and the cursor moves past
 * them: they miss this send rather than get it twice.
 */
export async function deliverPicked(
  env: Env,
  id: string,
  n: number,
  people: Recipient[],
  startedAt: number,
): Promise<number> {
  const db = dbOf(env);
  const row = await sendRow(db, id);
  const last = people.at(-1);
  if (!row || row.status !== "sending" || !last) return 0;
  const still = await stillReachable(
    db,
    row.list,
    people.map((person) => person.id),
    { filter: row.audience, now: startedAt },
  );
  const going = people.filter((person) => still.has(person.id));
  if (going.length > 0) await deliverBatch(env, issueOf(row), going, `${row.id}-batch-${n}`);
  await db
    .update(schema.newsletterSends)
    .set({ sent: sql`${schema.newsletterSends.sent} + ${going.length}`, cursor: last.id })
    .where(and(eq(schema.newsletterSends.id, id), lt(schema.newsletterSends.cursor, last.id)));
  return going.length;
}

/**
 * The end of a send: sent, or failed when a batch failed every retry. Writes
 * the send's own wide event and its audit entry, once: a retried step finds
 * the row already ended and does nothing.
 */
export async function finishSend(env: Env, id: string, outcome: "sent" | "failed") {
  const [row] = await dbOf(env)
    .update(schema.newsletterSends)
    .set({ status: outcome, finishedAt: new Date() })
    .where(and(eq(schema.newsletterSends.id, id), eq(schema.newsletterSends.status, "sending")))
    .returning();
  if (!row) return;
  const log = createLogger({
    operation: "newsletter.send",
    newsletter: {
      sendId: row.id,
      list: row.list,
      audience: row.audience,
      scheduled: row.scheduledFor !== null,
      sent: row.sent,
      outcome,
    },
  });
  log.audit({
    action: "newsletter.send.completed",
    actor: row.sentBy ? { type: "user", id: row.sentBy } : { type: "system", id: "newsletter" },
    target: { type: "newsletter", id: row.id },
    outcome: outcome === "sent" ? "success" : "failure",
  });
  if (outcome === "failed") log.warn("A newsletter batch failed every retry");
  log.emit();
}

/**
 * Cancels a scheduled send: the row first, so the workflow finds it
 * cancelled even if stopping it fails, then the workflow instance. A send
 * that has begun cannot be cancelled: some people already have it.
 */
export async function cancelSend(env: Env, id: string): Promise<SendRow> {
  const [row] = await dbOf(env)
    .update(schema.newsletterSends)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(schema.newsletterSends.id, id), eq(schema.newsletterSends.status, "scheduled")))
    .returning();
  if (!row) {
    throw createError({
      message: "Only a scheduled send can be cancelled",
      status: 409,
      why: `Send ${id} is not waiting to go`,
      fix: "Reload the page to see where it stands",
    });
  }
  // Best effort: a workflow that does not stop still finds the row cancelled.
  await env.NEWSLETTER_SEND.get(id)
    .then((instance) => instance.terminate())
    .catch(() => {});
  return row;
}
