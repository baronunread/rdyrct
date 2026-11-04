/**
 * The newsletter composer's API (admin only, under /api/admin, so it 404s for
 * everyone else like the rest of it).
 *
 * Every issue goes to one list, product news or offers, narrowed by the
 * audience filters (stage, plan). Who gets a send is decided in marketing.ts
 * (opted in to that list, verified, not banned, inside the filters) and
 * how it is delivered in newsletter.ts. This file is the doorway: it
 * parses the issue, counts, sends, and writes one wide event per request with
 * counts, never addresses.
 */
import { Hono } from "hono";
import * as v from "valibot";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppEnv, DB, Env } from "../env";
import { desc, eq } from "drizzle-orm";
import {
  AUDIENCE_PLANS,
  AUDIENCE_STAGES,
  EVERYONE,
  MARKETING_LISTS,
  type JsonValue,
  type NewsletterAudienceCount,
  type NewsletterSendResult,
  type NewsletterSendRow,
  type NewsletterStatus,
} from "../../shared/types";
import { countOptedIn, newsletterAnswers, optedInRecipients, sameAudience } from "../marketing";
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

const listField = v.picklist(MARKETING_LISTS, "list must be news or offers");

/** The filters, each "any" when left out. */
const audienceFields = {
  stage: v.optional(
    v.picklist(AUDIENCE_STAGES, "stage must be any, new, active or slipping"),
    "any",
  ),
  plan: v.optional(v.picklist(AUDIENCE_PLANS, "plan must be any, free or paid"), "any"),
};

const audienceSchema = v.object(audienceFields);

/** The count endpoint's query string. */
const countSchema = v.object({ list: listField, ...audienceFields });

const issueFields = {
  list: listField,
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
  audience: v.optional(audienceSchema, EVERYONE),
});

type IssueFields = v.InferOutput<typeof testSchema>;

function toIssue(fields: IssueFields): Issue {
  return { list: fields.list, subject: fields.subject, blocks: docToBlocks(fields.doc) };
}

export const adminNewsletterRoutes = new Hono<AppEnv>();

/** How many past sends the screen lists. */
const NEWSLETTER_HISTORY = 20;

/** The latest sends, newest first, with the sender as an email. */
async function recentSends(db: DB): Promise<NewsletterSendRow[]> {
  const rows = await db
    .select({
      id: schema.newsletterSends.id,
      list: schema.newsletterSends.list,
      audience: schema.newsletterSends.audience,
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
  const [news, offers, answers, sends] = await Promise.all([
    countOptedIn(db, "news"),
    countOptedIn(db, "offers"),
    newsletterAnswers(db),
    recentSends(db),
  ]);
  const status: NewsletterStatus = {
    optedIn: { news, offers },
    answers,
    sends,
    configured: newsletterConfigured(c.env),
  };
  return c.json(status);
});

// How many people a send to one list, narrowed by the filters, reaches now:
// the composer asks again whenever a filter changes.
adminNewsletterRoutes.get("/audience", async (c) => {
  const log = c.get("log");
  const { list, ...filter } = parseBody(countSchema, c.req.query());
  const count = await countOptedIn(drizzle(c.env.DB, { schema }), list, filter);
  log.set({ newsletter: { list, audience: filter, count } });
  return c.json({ count } satisfies NewsletterAudienceCount);
});

// A test goes to the admin alone, through the same path as a real send, so the
// headers and the footer link (for the chosen list) are the ones recipients get.
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
  log.set({ newsletter: { test: true, list: body.list, sent: 1 } });
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
 * one. Null when there is nothing to do because it finished. A send id that
 * already went to the other list, or to other filters, is refused: carrying
 * it on would mix two audiences in one send. */
async function progressOf(
  db: DB,
  sendId: string,
  start: Omit<SendProgress, "id" | "sent" | "cursor" | "done">,
): Promise<SendProgress | null> {
  const [earlier] = await db
    .select()
    .from(schema.newsletterSends)
    .where(eq(schema.newsletterSends.id, sendId));
  if (earlier && earlier.list !== start.list) {
    throw createError({
      message: "This send already went to the other list",
      status: 409,
      why: `Send ${sendId} started on ${earlier.list}, not ${start.list}`,
      fix: "Reload the page to start a new send",
    });
  }
  if (earlier && !sameAudience(earlier.audience, start.audience)) {
    throw createError({
      message: "This send already went to other filters",
      status: 409,
      why: `Send ${sendId} started on ${JSON.stringify(earlier.audience)}`,
      fix: "Reload the page to start a new send",
    });
  }
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
  // One line for the whole request between active and slipping away.
  const now = Date.now();
  const next = () =>
    optedInRecipients(db, row.list, BATCH_SIZE, { after: row.cursor, filter: row.audience, now });
  let page = await next();
  for (let batch = 0; batch < BATCHES_PER_REQUEST; batch += 1) {
    const [first] = page;
    const last = page.at(-1);
    if (!first || !last) break;
    await deliverBatch(env, issue, page, `${row.id}-${first.id}`);
    row.sent += page.length;
    row.cursor = last.id;
    await saveProgress(db, row);
    page = await next();
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
    list: body.list,
    audience: body.audience,
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
  if (row.sent === 0 && !(await countOptedIn(db, row.list, row.audience))) {
    throw createError({
      message: "Nobody on this list matches, so there is nobody to send to",
      status: 409,
      why: `No verified, unbanned account on ${row.list} matches ${JSON.stringify(row.audience)}`,
      fix: "Loosen the filters, or wait for more people to opt in",
    });
  }
  await sendBatches(c.env, db, issue, row);
  log.set({
    newsletter: {
      test: false,
      list: row.list,
      audience: row.audience,
      sendId: row.id,
      sent: row.sent,
      done: row.done,
    },
  });
  // After the send is stored: an audit that says success has to be true.
  log.audit({
    action: "newsletter.send",
    actor: { type: "user", id: admin.id },
    target: { type: "newsletter", id: row.id },
    outcome: "success",
  });
  return c.json({ sent: row.sent, done: row.done } satisfies NewsletterSendResult);
});
