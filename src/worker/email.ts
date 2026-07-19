import type { Env } from "./env";

/**
 * Sends via the Resend HTTP API. RESEND_BASE_URL lets local dev point at the
 * emulate.dev Resend emulator instead of the real service.
 */
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const base = env.RESEND_BASE_URL || "https://api.resend.com";
  const res = await fetch(`${base}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, html }),
  });
  if (!res.ok)
    throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
}
