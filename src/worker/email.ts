import type { Env } from "./env";
import type { EmailBody } from "./email-layout";

export const emailConfigured = (env: Env) => Boolean(env.RESEND_API_KEY);

// body comes from renderEmail(): every send has a plain-text part (#73), and
// SafeHtml keeps user input out of a template literal (#72).
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  body: EmailBody,
  options: { from?: string } = {},
): Promise<void> {
  // No provider, no mail. Nothing is logged: a code or reset link in a log
  // is a secret in the wrong place.
  if (!emailConfigured(env)) return;
  const base = env.RESEND_BASE_URL || "https://api.resend.com";
  const res = await fetch(`${base}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: options.from ?? env.MAIL_FROM,
      to,
      subject,
      html: body.html.html,
      text: body.text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
}
