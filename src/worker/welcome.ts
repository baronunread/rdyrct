import { and, eq, isNull } from "drizzle-orm";
import * as schema from "./db/schema";
import { emailConfigured, sendEmail } from "./email";
import { renderEmail } from "./email-layout";
import type { DB, Env } from "./env";
import { captureAlert } from "./sentry";

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
  if (!user.emailVerified || !emailConfigured(env) || !env.WELCOME_FROM) return;
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
          preheader: "Go shorten any link for free right now.",
          heading: "Thanks for signing up",
          paragraphs: [
            "I'm Andrea, the founder of rdyrct, and I'm glad you're here.",
            "Go shorten any link for free right now!",
          ],
          hero: {
            sample: {
              long: "https://example.com/a/very/long/link?utm_source=news",
              short: `${env.SHARED_LINK_HOST || new URL(env.APP_URL).host}/hello`,
            },
          },
          cta: { label: "Shorten a link", url: `${env.APP_URL}/dashboard` },
          note: "P.S. Got something to say? I read every mail, just hit reply!",
          footer: false,
        },
        env.APP_URL,
        user.email,
      ),
      { from: env.WELCOME_FROM },
    );
  } catch (cause) {
    // No address: this log would otherwise be a list of registered emails.
    captureAlert([{ event: "welcome_email_failed", error: String(cause) }]);
  }
}
