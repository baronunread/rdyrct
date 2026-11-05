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
import type { AppEnv, DB } from "../env";
import { desc, eq, sql } from "drizzle-orm";
import {
  AUDIENCE_PLANS,
  AUDIENCE_STAGES,
  EVERYONE,
  MARKETING_LISTS,
  type JsonValue,
  type NewsletterAudienceCount,
  type NewsletterDraft,
  type NewsletterPreview,
  type NewsletterSendRow,
  type NewsletterSendState,
  type NewsletterTestResult,
  type NewsletterStatus,
} from "../../shared/types";
import { countOptedIn, newsletterAnswers } from "../marketing";
import { deliverBatch, newsletterConfigured, renderIssue, type Issue } from "../newsletter";
import { cancelSend, startSend } from "../newsletter-send";
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
  // When it goes, epoch ms; left out, it goes now.
  scheduledFor: v.optional(
    v.pipe(v.number("scheduledFor must be a time"), v.integer("scheduledFor must be a time")),
  ),
});

type IssueFields = v.InferOutput<typeof testSchema>;

function toIssue(fields: IssueFields): Issue {
  return { list: fields.list, subject: fields.subject, blocks: docToBlocks(fields.doc) };
}

export const adminNewsletterRoutes = new Hono<AppEnv>();

/** How many past sends the screen lists. */
const NEWSLETTER_HISTORY = 20;

const sends = schema.newsletterSends;
const waiting = sql`${sends.status} = 'scheduled'`;

/** Scheduled sends first, soonest first, then the rest, newest first, with
 * the sender as an email. */
async function recentSends(db: DB): Promise<NewsletterSendRow[]> {
  const rows = await db
    .select({
      id: sends.id,
      list: sends.list,
      audience: sends.audience,
      subject: sends.subject,
      sentBy: schema.user.email,
      createdAt: sends.createdAt,
      scheduledFor: sends.scheduledFor,
      status: sends.status,
      sent: sends.sent,
      finishedAt: sends.finishedAt,
    })
    .from(sends)
    .leftJoin(schema.user, eq(schema.user.id, sends.sentBy))
    .orderBy(
      desc(waiting),
      sql`case when ${waiting} then ${sends.scheduledFor} end`,
      desc(sql`coalesce(${sends.scheduledFor}, ${sends.createdAt})`),
    )
    .limit(NEWSLETTER_HISTORY);
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.getTime(),
    scheduledFor: row.scheduledFor?.getTime() ?? null,
    finishedAt: row.finishedAt?.getTime() ?? null,
  }));
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
    postalAddress: Boolean(c.env.POSTAL_ADDRESS),
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
  return c.json({ count, list, filter } satisfies NewsletterAudienceCount);
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
  return c.json({ sent: 1 } satisfies NewsletterTestResult);
});

// The issue rendered as the admin would get it, by the same renderEmail call
// a send makes, for the composer's Preview. Nothing is sent.
adminNewsletterRoutes.post("/preview", async (c) => {
  const log = c.get("log");
  const admin = c.var.user!;
  const body = parseBody(testSchema, await c.req.json<JsonValue>().catch(() => null));
  const { body: rendered } = await renderIssue(c.env, toIssue(body), {
    id: admin.id,
    email: admin.email,
  });
  log.set({ newsletter: { preview: true, list: body.list } });
  return c.json({ html: rendered.html.html } satisfies NewsletterPreview);
});

// One send's issue and audience, for Duplicate in the history.
adminNewsletterRoutes.get("/sends/:id", async (c) => {
  const log = c.get("log");
  const id = c.req.param("id");
  const [row] = await drizzle(c.env.DB, { schema })
    .select({ list: sends.list, audience: sends.audience, subject: sends.subject, doc: sends.doc })
    .from(sends)
    .where(eq(sends.id, id));
  log.set({ newsletter: { sendId: id, found: Boolean(row) } });
  if (!row) {
    throw createError({
      message: "That send is gone",
      status: 404,
      why: `No newsletter send ${id}`,
      fix: "Reload the page",
    });
  }
  return c.json(row satisfies NewsletterDraft);
});

/** The furthest ahead a send can be scheduled. */
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/** A scheduled time must be ahead of now (a minute of slack for the clock
 * between the browser and here) and inside a year. */
function checkScheduledFor(at: number | undefined): Date | null {
  if (at === undefined) return null;
  const now = Date.now();
  if (at < now - 60_000 || at > now + MAX_AHEAD_MS) {
    throw createError({
      message: at < now ? "Pick a time in the future" : "Pick a time within a year",
      status: 400,
      why: `scheduledFor ${at} is outside the next year`,
      fix: "Choose another date and time",
    });
  }
  return new Date(at);
}

/**
 * Send now or Schedule. Stores the issue and starts the send's workflow
 * (newsletter-send.ts), which waits for the time and sends batch by batch.
 * The same send id again (a double click, a retry) answers the first one's
 * state and sends nothing twice.
 */
adminNewsletterRoutes.post("/send", async (c) => {
  const log = c.get("log");
  const admin = c.var.user!;
  const body = parseBody(sendSchema, await c.req.json<JsonValue>().catch(() => null));
  // Parsed here so a bad document is a 400 now, not a failure at send time.
  docToBlocks(body.doc);
  const state = await startSend(c.env, {
    id: body.sendId,
    list: body.list,
    audience: body.audience,
    subject: body.subject,
    doc: body.doc,
    sentBy: admin.id,
    scheduledFor: checkScheduledFor(body.scheduledFor),
  });
  log.set({
    newsletter: {
      test: false,
      list: body.list,
      audience: body.audience,
      sendId: state.id,
      status: state.status,
      scheduledFor: state.scheduledFor,
    },
  });
  log.audit({
    action: "newsletter.send.scheduled",
    actor: { type: "user", id: admin.id },
    target: { type: "newsletter", id: state.id },
    outcome: "success",
  });
  return c.json(state satisfies NewsletterSendState);
});

/** Cancels a send that is waiting for its time. */
adminNewsletterRoutes.post("/sends/:id/cancel", async (c) => {
  const log = c.get("log");
  const admin = c.var.user!;
  const row = await cancelSend(c.env, c.req.param("id"));
  log.set({ newsletter: { sendId: row.id, list: row.list, status: row.status } });
  log.audit({
    action: "newsletter.send.cancelled",
    actor: { type: "user", id: admin.id },
    target: { type: "newsletter", id: row.id },
    outcome: "success",
  });
  return c.json({
    id: row.id,
    status: row.status,
    scheduledFor: row.scheduledFor?.getTime() ?? null,
  } satisfies NewsletterSendState);
});
