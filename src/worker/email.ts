import type { Env } from "./env";

/** Both bodies for one message: a text-only client falls back to `text`. */
export type EmailBody = { html: string; text: string };

/**
 * Sends via the Resend HTTP API. RESEND_BASE_URL lets local dev point at the
 * emulate.dev Resend emulator instead of the real service.
 *
 * Pass a rendered {@link EmailBody} (from {@link renderEmail}) so every message
 * carries both an HTML and a plain-text part. A multipart message reads as less
 * spammy and still shows up in text-only clients.
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
      html: body.html,
      text: body.text,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().catch(() => "")}`);
}

/** Escapes text for both element content and double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A piece of an email body. Build these with {@link p}, {@link button}, and
 * {@link code} so each call site stays free of markup and every interpolated
 * value gets escaped in one place ({@link renderEmail}).
 */
export type EmailBlock =
  | { type: "text"; value: string }
  | { type: "button"; label: string; url: string }
  | { type: "code"; value: string };

/** A paragraph of body text. */
export const p = (value: string): EmailBlock => ({ type: "text", value });
/** A call-to-action button. In the text part it becomes `label: url`. */
export const button = (label: string, url: string): EmailBlock => ({ type: "button", label, url });
/** A short code to read back, e.g. a verification OTP. */
export const code = (value: string): EmailBlock => ({ type: "code", value });

const FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

function blockHtml(block: EmailBlock): string {
  switch (block.type) {
    case "text":
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#18181b">${escapeHtml(block.value)}</p>`;
    case "code":
      return `<p style="margin:0 0 16px"><span style="display:inline-block;padding:12px 20px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;font-size:28px;font-weight:700;letter-spacing:6px;color:#18181b">${escapeHtml(block.value)}</span></p>`;
    case "button":
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="border-radius:8px;background:#18181b"><a href="${escapeHtml(block.url)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${escapeHtml(block.label)}</a></td></tr></table>`;
  }
}

function blockText(block: EmailBlock): string {
  switch (block.type) {
    case "text":
      return block.value;
    case "code":
      return block.value;
    case "button":
      return `${block.label}: ${block.url}`;
  }
}

/**
 * Wraps body blocks in the shared layout and returns both bodies. The HTML uses
 * table-based markup with inline styles (the reliable subset across email
 * clients) and opens with a hidden preheader span, the short line inbox
 * previews show next to the subject. Everything is self-contained: no remote
 * fonts, images, or scripts.
 */
export function renderEmail(content: {
  heading: string;
  preheader: string;
  blocks: EmailBlock[];
}): EmailBody {
  const body = content.blocks.map(blockHtml).join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(content.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:${FONT}">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all">${escapeHtml(content.preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f4f5">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px">
<tr><td style="padding:28px 32px 8px">
<div style="font-size:18px;font-weight:700;letter-spacing:1px;color:#18181b">rdyrct</div>
</td></tr>
<tr><td style="padding:8px 32px 24px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#18181b">${escapeHtml(content.heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e4e4e7">
<p style="margin:0;font-size:12px;line-height:1.5;color:#71717a">rdyrct, the link shortener. https://rdyrct.com</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    content.heading,
    "",
    ...content.blocks.map(blockText),
    "",
    "--",
    "rdyrct, the link shortener. https://rdyrct.com",
  ].join("\n");

  return { html, text };
}
