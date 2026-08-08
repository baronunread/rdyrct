import type { Env } from "./env";
import type { EmailBody } from "./email-layout";

/**
 * Sends via the Resend HTTP API. RESEND_BASE_URL lets local dev point at the
 * emulate.dev Resend emulator instead of the real service.
 *
 * `body` carries both parts and comes from renderEmail(), which is the only
 * thing that builds one. Two consequences, both deliberate: every send ships
 * a plain-text alternative rather than HTML alone (#73), and its HTML is
 * SafeHtml, so a template literal built from user input does not compile
 * (#72).
 */
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  body: EmailBody,
): Promise<void> {
  const base = env.RESEND_BASE_URL || "https://api.resend.com";
  const res = await fetch(`${base}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to,
      subject,
      html: body.html.html,
      text: body.text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
}
