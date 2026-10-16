import { and, eq, isNull } from "drizzle-orm";
import * as schema from "./db/schema";
import { emailConfigured, sendEmail } from "./email";
import { renderEmail } from "./email-layout";
import type { DB, Env } from "./env";
import { captureAlert } from "./sentry";

const FOUNDER_EMAIL = "andrea@mail.rdyrct.com";

/**
 * The welcome email: one message, sent once, when an address is verified.
 *
 * It is a service message about the account the person just made, so it
 * carries no promotion and needs no unsubscribe link or consent. Keep it that
 * way: an upgrade pitch or a second email in a sequence is marketing, which
 * goes through Resend Broadcasts to people who opted in (rdyrct-email skill).
 *
 * "Once" is a claim on `welcome_sent_at`: the UPDATE only matches while the
 * column is null, so of two racing calls (a retried hook, a re-verification)
 * exactly one gets a row back and sends. A failed send is alerted and not
 * retried: the person missing a welcome is the smaller loss.
 */
export async function sendWelcomeOnce(
  env: Env,
  db: DB,
  user: { id: string; email: string; emailVerified: boolean },
): Promise<void> {
  if (!user.emailVerified || !emailConfigured(env)) return;
  const claimed = await db
    .update(schema.user)
    .set({ welcomeSentAt: new Date() })
    .where(and(eq(schema.user.id, user.id), isNull(schema.user.welcomeSentAt)))
    .returning({ id: schema.user.id });
  if (claimed.length === 0) return;
  try {
    await sendEmail(
      env,
      user.email,
      "Welcome to rdyrct",
      renderEmail(
        {
          preheader: "No onboarding call, no webinar. Just a box for your first link.",
          heading: "Welcome. Nobody will call you.",
          paragraphs: [
            "I'm Andrea, and I built rdyrct. There is no onboarding call, no webinar and no sales team. There is a box on your dashboard: paste a long link, get a short one.",
            "Your link statistics show country, referrer and device. Never an IP address.",
            "Questions, bugs, or something missing? Reply to this email. It comes to me.",
          ],
          cta: { label: "Shorten your first link", url: `${env.APP_URL}/dashboard` },
          footer: false,
        },
        env.APP_URL,
        user.email,
      ),
      { fromName: "Andrea at rdyrct", replyTo: FOUNDER_EMAIL },
    );
  } catch (cause) {
    // No address: this log would otherwise be a list of registered emails.
    captureAlert([{ event: "welcome_email_failed", error: String(cause) }]);
  }
}
