import { and, eq, isNull } from "drizzle-orm";
import * as schema from "./db/schema";
import { emailConfigured, sendEmail } from "./email";
import { renderEmail } from "./email-layout";
import type { DB, Env } from "./env";
import { captureAlert } from "./sentry";

/**
 * A service message: no promotion, unsubscribe link or consent. A pitch is marketing and
 * goes through the newsletter (rdyrct-email skill). "Once" is a claim on `welcome_sent_at`:
 * the UPDATE matches only while null. A failed send is not retried.
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
          preheader: "You can shorten links for free now.",
          heading: "Thanks for signing up",
          paragraphs: [
            "I'm Andrea, the founder of rdyrct, and I'm glad you're here.",
            "You can shorten links for free now.",
          ],
          hero: {
            sample: {
              long: "https://example.com/a/very/long/link?utm_source=news",
              short: `${env.SHARED_LINK_HOST || new URL(env.APP_URL).host}/hello`,
            },
          },
          cta: { label: "Shorten a link", url: `${env.APP_URL}/dashboard` },
          note: "P.S. Got something to say? Reply to this email. I read every one.",
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
