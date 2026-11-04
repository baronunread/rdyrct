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
import { renderEmail } from "./email-layout";
import type { Env } from "./env";
import { unsubscribeUrl } from "./marketing";

/** The provider takes up to 100 messages per call. */
export const BATCH_SIZE = 100;

/** The most one send reaches: 50 calls, well inside a Worker's subrequest
 * budget. A bigger list is refused rather than cut short, so nobody is left
 * out without the admin knowing. Past this, send through a Workflow. */
export const MAX_RECIPIENTS = BATCH_SIZE * 50;

export interface Issue {
  subject: string;
  /** Plain paragraphs. The admin screen splits the body on blank lines. */
  paragraphs: string[];
  cta?: { label: string; url: string };
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
      preheader: issue.paragraphs[0]?.slice(0, 120) ?? issue.subject,
      heading: issue.subject,
      paragraphs: issue.paragraphs,
      cta: issue.cta,
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
 * no-op there, so a double click or a timed-out request does not send twice. */
async function postBatch(env: Env, emails: OutgoingEmail[], idempotencyKey: string) {
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
  if (!res.ok) {
    throw createError({
      message: "The email provider refused a batch",
      status: 502,
      why: `Provider answered ${res.status}`,
      fix: "Send again with the same send id: batches already sent are not repeated",
      internal: { status: res.status, body: await res.text().catch(() => "") },
    });
  }
}

/**
 * Sends `issue` to each recipient and returns how many went out. Throws a
 * structured error, never a partial success: the admin sees a failure and
 * resends with the same `sendId`, which the provider answers from its record
 * for every batch that already went.
 */
export async function deliverNewsletter(
  env: Env,
  issue: Issue,
  recipients: Recipient[],
  sendId: string,
): Promise<number> {
  const from = env.NEWSLETTER_FROM;
  if (!from || !newsletterConfigured(env)) {
    throw createError({
      message: "Newsletters are not set up on this instance",
      status: 409,
      why: "NEWSLETTER_FROM or the email provider is not configured",
      fix: "Set NEWSLETTER_FROM to a sender on its own subdomain, and RESEND_API_KEY",
    });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw createError({
      message: `More than ${MAX_RECIPIENTS} people are opted in`,
      status: 409,
      why: "One send is limited to what a Worker can post in one request",
      fix: "Send through a Workflow instead",
    });
  }
  let sent = 0;
  for (let at = 0; at < recipients.length; at += BATCH_SIZE) {
    const batch = await Promise.all(
      recipients.slice(at, at + BATCH_SIZE).map((to) => outgoing(env, from, issue, to)),
    );
    await postBatch(env, batch, `${sendId}-${at / BATCH_SIZE}`);
    sent += batch.length;
  }
  return sent;
}
