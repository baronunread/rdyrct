/**
 * Sending a newsletter, and the only module that knows which provider does it.
 *
 * No subscriber list lives at the provider. The opted-in users are in our D1
 * (marketing.ts) and this app sends each issue itself, one email per person,
 * through the provider's batch endpoint. Moving to another provider means
 * rewriting `postBatch` here and `emailConfigured` in email.ts, nothing else.
 *
 * The same plain `fetch` and RESEND_BASE_URL as sendEmail, so the dev
 * emulator receives newsletters too.
 *
 * Every email carries its own unsubscribe link, in the footer and in the
 * RFC 8058 one-click headers Gmail and Yahoo require of bulk mail.
 */
import { createError } from "evlog";
import { emailConfigured } from "./email";
import { type EmailBlock, blocksPreview, renderEmail } from "./email-layout";
import type { Env } from "./env";
import { unsubscribeUrl } from "./marketing";

/** The provider takes up to 100 messages per call. */
export const BATCH_SIZE = 100;

/** Batches one request posts, well inside a Worker's subrequest budget.
 * Past it the send stops with its progress saved, and the admin sends again
 * to carry on (routes/admin-newsletter.ts). */
export const BATCHES_PER_REQUEST = 40;

export interface Issue {
  subject: string;
  /** The body, written in the admin editor (newsletter-doc.ts parses it). */
  blocks: EmailBlock[];
}

export interface Recipient {
  id: string;
  email: string;
}

interface OutgoingEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

/** Whether this instance may send newsletters: a provider and a sender. */
export function newsletterConfigured(env: Env): boolean {
  return emailConfigured(env) && Boolean(env.NEWSLETTER_FROM);
}

/** One person's copy: their own link in the footer and in the headers. */
async function outgoing(
  env: Env,
  from: string,
  issue: Issue,
  to: Recipient,
): Promise<OutgoingEmail> {
  const link = await unsubscribeUrl(env, to.id);
  const body = renderEmail(
    {
      preheader: blocksPreview(issue.blocks) || issue.subject,
      heading: issue.subject,
      paragraphs: [],
      blocks: issue.blocks,
      footerLine: "You get this because you opted in to product news.",
      unsubscribeUrl: link,
    },
    env.APP_URL,
    to.email,
  );
  return {
    from,
    to: [to.email],
    subject: issue.subject,
    html: body.html.html,
    text: body.text,
    headers: {
      // RFC 8058: a mail client posts to this URL itself, with no cookie.
      "List-Unsubscribe": `<${link}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

/** The provider call. `idempotencyKey` makes a retry of the same batch a
 * no-op there, so a double click or a timed-out request does not send twice.
 * A key the provider has seen with a different list of people (a retry after
 * someone in the batch unsubscribed) is refused with a 409: that batch went
 * already, so it counts as sent, not as a failure. */
async function postBatch(
  env: Env,
  emails: OutgoingEmail[],
  idempotencyKey: string,
): Promise<"sent" | "sent-before"> {
  const base = env.RESEND_BASE_URL || "https://api.resend.com";
  const res = await fetch(`${base}/emails/batch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(emails),
  });
  if (res.ok) return "sent";
  const detail = await res.text().catch(() => "");
  if (res.status === 409 && detail.includes("invalid_idempotent_request")) return "sent-before";
  throw createError({
    message: "The email provider refused a batch",
    status: 502,
    why: `Provider answered ${res.status}`,
    fix: "Send again: the send carries on from the last batch that went",
    internal: { status: res.status, body: detail },
  });
}

/** The sender, or a structured 409 when this instance cannot send. */
function newsletterSender(env: Env): string {
  const from = env.NEWSLETTER_FROM;
  if (!from || !newsletterConfigured(env)) {
    throw createError({
      message: "Newsletters are not set up on this instance",
      status: 409,
      why: "NEWSLETTER_FROM or the email provider is not configured",
      fix: "Set NEWSLETTER_FROM to a sender on its own subdomain, and RESEND_API_KEY",
    });
  }
  return from;
}

/**
 * Sends `issue` to one batch of at most BATCH_SIZE people, each with their
 * own unsubscribe link. `key` names the batch for the provider's
 * idempotency check; "sent-before" means the provider had it already.
 */
export async function deliverBatch(
  env: Env,
  issue: Issue,
  recipients: Recipient[],
  key: string,
): Promise<"sent" | "sent-before"> {
  const from = newsletterSender(env);
  const emails = await Promise.all(recipients.map((to) => outgoing(env, from, issue, to)));
  return postBatch(env, emails, key);
}
