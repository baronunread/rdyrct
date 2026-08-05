import type { Env } from "./env";
import type { SafeHtml } from "./email-html";

/**
 * Sends via the Resend HTTP API. RESEND_BASE_URL lets local dev point at the
 * emulate.dev Resend emulator instead of the real service.
 *
 * `html` is SafeHtml rather than a string on purpose: the only way to make
 * one is the `emailHtml` tag, which escapes what it interpolates, so a send
 * built by pasting user input into a template literal does not compile (#72).
 */
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: SafeHtml,
): Promise<void> {
  const base = env.RESEND_BASE_URL || "https://api.resend.com";
  const res = await fetch(`${base}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html: html.html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
}
