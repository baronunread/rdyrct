/**
 * The only module that knows the provider. No list lives there: opted-in users are in D1
 * (marketing.ts). Each email carries its own unsubscribe link and the RFC 8058 one-click
 * headers Gmail and Yahoo require of bulk mail.
 */
import { createError } from "evlog";
import { emailConfigured } from "./email";
import { type EmailBlock, type EmailBody, blocksPreview, renderEmail } from "./email-layout";
import type { Env } from "./env";
import { unsubscribeUrl } from "./marketing";
import type { MarketingList } from "@/shared/types";

export const BATCH_SIZE = 100;

export interface Issue {
  list: MarketingList;
  subject: string;
  blocks: EmailBlock[];
}

export interface Recipient {
  id: string;
  email: string;
}

interface OutgoingEmail {
  from: string;
  to: string[];
  reply_to?: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export function newsletterConfigured(env: Env): boolean {
  return emailConfigured(env) && Boolean(env.NEWSLETTER_FROM);
}

const FOOTER_LINE = {
  news: "You get this because you opted in to product news from rdyrct.",
  offers: "You get this because you opted in to offers from rdyrct.",
} satisfies Record<MarketingList, string>;

export async function renderIssue(
  env: Env,
  issue: Issue,
  to: Recipient,
): Promise<{ body: EmailBody; link: string }> {
  const link = await unsubscribeUrl(env, to.id, issue.list);
  const body = renderEmail(
    {
      preheader: blocksPreview(issue.blocks) || issue.subject,
      heading: issue.subject,
      paragraphs: [],
      blocks: issue.blocks,
      footerLine: FOOTER_LINE[issue.list],
      unsubscribeUrl: link,
      postalAddress: env.POSTAL_ADDRESS,
    },
    env.APP_URL,
    to.email,
  );
  return { body, link };
}

async function outgoing(
  env: Env,
  from: string,
  issue: Issue,
  to: Recipient,
): Promise<OutgoingEmail> {
  const { body, link } = await renderIssue(env, issue, to);
  const email: OutgoingEmail = {
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
  if (env.NEWSLETTER_REPLY_TO) email.reply_to = env.NEWSLETTER_REPLY_TO;
  return email;
}

/**
 * `idempotencyKey` makes a retry a no-op. A key seen with a different list of
 * people (someone unsubscribed since) is refused with a 409: that batch went
 * already, so it counts as sent.
 */
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
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 409 && detail.includes("invalid_idempotent_request")) return "sent-before";
    throw createError({
      message: "The email provider refused a batch",
      status: 502,
      why: `Provider answered ${res.status}`,
      fix: "The send retries this batch on its own, from the last batch that went",
      internal: { status: res.status, body: detail },
    });
  }
  return "sent";
}

export function newsletterSender(env: Env): string {
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

/** "sent-before" means the provider had the key already. */
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
