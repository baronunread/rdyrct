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
import type { AppEnv, DB } from "../env";
import { desc, eq } from "drizzle-orm";
import type {
  JsonValue,
  NewsletterSendResult,
  NewsletterSendRow,
  NewsletterStatus,
} from "../../shared/types";
import { countOptedIn, newsletterAnswers, optedInRecipients } from "../marketing";
import { MAX_RECIPIENTS, deliverNewsletter, newsletterConfigured, type Issue } from "../newsletter";
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
    maxRecipients: MAX_RECIPIENTS,
  };
  return c.json(status);
});

// A test goes to the admin alone, through the same path as a real send, so the
// headers and the footer link are the ones recipients get.
adminNewsletterRoutes.post("/test", async (c) => {
  const log = c.get("log");
  const admin = c.var.user!;
  const body = parseBody(testSchema, await c.req.json<JsonValue>().catch(() => null));
  const sent = await deliverNewsletter(
    c.env,
    toIssue(body),
    [{ id: admin.id, email: admin.email }],
    `test-${crypto.randomUUID()}`,
  );
  log.set({ newsletter: { test: true, sent } });
  return c.json({ sent } satisfies NewsletterSendResult);
});

adminNewsletterRoutes.post("/send", async (c) => {
  const log = c.get("log");
  const admin = c.var.user!;
  const body = parseBody(sendSchema, await c.req.json<JsonValue>().catch(() => null));
  const issue = toIssue(body);
  // One past the cap, so deliverNewsletter can tell "exactly full" from "over".
  const recipients = await optedInRecipients(drizzle(c.env.DB, { schema }), MAX_RECIPIENTS + 1);
  log.set({ newsletter: { test: false, recipients: recipients.length, sendId: body.sendId } });
  log.audit({
    action: "newsletter.send",
    actor: { type: "user", id: admin.id },
    target: { type: "newsletter", id: body.sendId },
    outcome: "success",
  });
  const sent = await deliverNewsletter(c.env, issue, recipients, body.sendId);
  log.set({ newsletter: { sent } });
  // Recorded once it went. A retry of the same issue (same send id) rewrites
  // its row rather than listing the issue twice.
  const row = { subject: issue.subject, sentBy: admin.id, sentAt: new Date(), sent };
  await drizzle(c.env.DB, { schema })
    .insert(schema.newsletterSends)
    .values({ id: body.sendId, ...row })
    .onConflictDoUpdate({ target: schema.newsletterSends.id, set: row });
  return c.json({ sent } satisfies NewsletterSendResult);
});
