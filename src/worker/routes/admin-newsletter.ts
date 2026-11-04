/**
 * The newsletter composer's API (admin only, under /api/admin, so it 404s for
 * everyone else like the rest of it).
 *
 * Who gets a send is decided in marketing.ts (opted in, verified, not banned)
 * and how it is delivered in newsletter.ts. This file is the doorway: it
 * parses the issue, counts, sends, and writes one wide event per request with
 * counts, never addresses.
 */
import { Hono } from "hono";
import * as v from "valibot";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { desc, eq } from "drizzle-orm";
import type {
  JsonValue,
  NewsletterSendResult,
  NewsletterSendRow,
  NewsletterStatus,
} from "../../shared/types";
import { countOptedIn, newsletterAnswers, optedInRecipients } from "../marketing";
import {
  BATCHES_PER_REQUEST,
  BATCH_SIZE,
  deliverBatch,
  newsletterConfigured,
  type Issue,
} from "../newsletter";
import { createError } from "evlog";
import { parseBody } from "../schemas";
import { docToBlocks, newsletterDocSchema } from "../newsletter-doc";

const issueFields = {
  subject: v.pipe(
    v.string("subject is required"),
    v.trim(),
    v.minLength(1, "Add a subject"),
    v.maxLength(150, "The subject is too long"),
  ),
  // The editor's JSON document, never HTML: newsletter-doc.ts allows only
  // the nodes and marks the email layout renders.
  doc: newsletterDocSchema,
};

const testSchema = v.object(issueFields);
const sendSchema = v.object({
  ...issueFields,
  // One per composed issue: the provider ignores a batch it already sent under
  // the same id, so a double click or a retry cannot send twice.
  sendId: v.pipe(v.string("sendId is required"), v.regex(/^[\w-]{8,64}$/, "sendId is not valid")),
});

type IssueFields = v.InferOutput<typeof testSchema>;

function toIssue(fields: IssueFields): Issue {
  return { subject: fields.subject, blocks: docToBlocks(fields.doc) };
}

export const adminNewsletterRoutes = new Hono<AppEnv>();

/** How many past sends the screen lists. */
const NEWSLETTER_HISTORY = 20;

/** The latest sends, newest first, with the sender as an email. */
async function recentSends(db: DB): Promise<NewsletterSendRow[]> {
  const rows = await db
    .select({
      id: schema.newsletterSends.id,
      subject: schema.newsletterSends.subject,
      sentBy: schema.user.email,
      sentAt: schema.newsletterSends.sentAt,
      sent: schema.newsletterSends.sent,
      done: schema.newsletterSends.done,
    })
    .from(schema.newsletterSends)
    .leftJoin(schema.user, eq(schema.user.id, schema.newsletterSends.sentBy))
    .orderBy(desc(schema.newsletterSends.sentAt))
    .limit(NEWSLETTER_HISTORY);
  return rows.map((row) => ({ ...row, sentAt: row.sentAt.getTime() }));
}

adminNewsletterRoutes.get("/", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [optedIn, answers, sends] = await Promise.all([
    countOptedIn(db),
    newsletterAnswers(db),
    recentSends(db),
  ]);
  const status: NewsletterStatus = {
    optedIn,
    answers,
    sends,
    configured: newsletterConfigured(c.env),
  };
  return c.json(status);
});

// A test goes to the admin alone, through the same path as a real send, so the
// headers and the footer link are the ones recipients get.
adminNewsletterRoutes.post("/test", async (c) => {
  const log = c.get("log");
  const admin = c.var.user!;
  const body = parseBody(testSchema, await c.req.json<JsonValue>().catch(() => null));
  await deliverBatch(
    c.env,
    toIssue(body),
    [{ id: admin.id, email: admin.email }],
    `test-${crypto.randomUUID()}`,
  );
  log.set({ newsletter: { test: true, sent: 1 } });
  return c.json({ sent: 1, done: true } satisfies NewsletterSendResult);
});

/** A send's row, every field present: what saveProgress writes. */
type SendProgress = typeof schema.newsletterSends.$inferSelect;

/** Saves how far a send got, after every batch, so a stopped send carries on. */
function saveProgress(db: DB, row: SendProgress) {
  const { id: _, ...progress } = row;
  return db
    .insert(schema.newsletterSends)
    .values(row)
    .onConflictDoUpdate({ target: schema.newsletterSends.id, set: progress });
}

/** The send's row as it stands: where an earlier request stopped, or a new
 * one. Null when there is nothing to do because it finished. */
async function progressOf(
  db: DB,
  sendId: string,
  start: Omit<SendProgress, "id" | "sent" | "cursor" | "done">,
): Promise<SendProgress | null> {
  const [earlier] = await db
    .select()
    .from(schema.newsletterSends)
    .where(eq(schema.newsletterSends.id, sendId));
  if (earlier?.done) return null;
  return earlier ?? { id: sendId, ...start, sent: 0, cursor: "", done: false };
}

/**
 * Posts batches from where `row` stopped, at most BATCHES_PER_REQUEST of
 * them, and saves the row after each. People are read fresh for every batch,
 * so whoever unsubscribed in the meantime is left out. Each batch's provider
 * key is the send id and its first recipient, the same on a retry.
 */
async function sendBatches(env: Env, db: DB, issue: Issue, row: SendProgress) {
  let page = await optedInRecipients(db, BATCH_SIZE, row.cursor);
  for (let batch = 0; batch < BATCHES_PER_REQUEST; batch += 1) {
    const [first] = page;
    const last = page.at(-1);
    if (!first || !last) break;
    await deliverBatch(env, issue, page, `${row.id}-${first.id}`);
    row.sent += page.length;
    row.cursor = last.id;
    await saveProgress(db, row);
    page = await optedInRecipients(db, BATCH_SIZE, row.cursor);
  }
  row.done = page.length === 0;
  await saveProgress(db, row);
}

/**
 * Sends an issue in batches of people read fresh from D1, oldest id first.
 * A request that stops (a provider error, or the batch limit) leaves its
 * progress saved, and sending again with the same send id carries on from
 * there; nobody gets it twice.
 */
adminNewsletterRoutes.post("/send", async (c) => {
  const log = c.get("log");
  const admin = c.var.user!;
  const db = drizzle(c.env.DB, { schema });
  const body = parseBody(sendSchema, await c.req.json<JsonValue>().catch(() => null));
  const issue = toIssue(body);
  const row = await progressOf(db, body.sendId, {
    subject: issue.subject,
    sentBy: admin.id,
    sentAt: new Date(),
  });
  if (!row) {
    const [done] = await db
      .select({ sent: schema.newsletterSends.sent })
      .from(schema.newsletterSends)
      .where(eq(schema.newsletterSends.id, body.sendId));
    return c.json({ sent: done?.sent ?? 0, done: true } satisfies NewsletterSendResult);
  }
  if (row.sent === 0 && !(await countOptedIn(db))) {
    throw createError({
      message: "Nobody is opted in, so there is nobody to send to",
      status: 409,
      why: "No verified, unbanned account has opted in to product news",
    });
  }
  await sendBatches(c.env, db, issue, row);
  log.set({ newsletter: { test: false, sendId: row.id, sent: row.sent, done: row.done } });
  // After the send is stored: an audit that says success has to be true.
  log.audit({
    action: "newsletter.send",
    actor: { type: "user", id: admin.id },
    target: { type: "newsletter", id: row.id },
    outcome: "success",
  });
  return c.json({ sent: row.sent, done: row.done } satisfies NewsletterSendResult);
});
