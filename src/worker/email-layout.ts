import { type SafeHtml, emailHtml, safeUrl } from "./email-html";

/**
 * One layout for every outbound email, rendering both parts from a single
 * call so no send can ship HTML-only (#73).
 *
 * Email HTML is its own dialect: tables for layout, inline styles, no
 * flexbox or grid, and no shared CSS with the app. The palette below mirrors
 * the app's light tokens by value rather than by import, since a stylesheet
 * is not available here. A dark variant rides on prefers-color-scheme, but
 * plenty of clients ignore it, so the light rendering has to stand alone.
 */

const LIGHT = {
  bg: "#f7f4ef",
  surface: "#ffffff",
  surface2: "#efeae2",
  border: "#ddd5c8",
  text: "#2a2733",
  muted: "#6e6880",
  accent: "#7a5fc2",
};

const DARK = {
  bg: "#17151f",
  surface: "#1f1c2b",
  surface2: "#262336",
  border: "#34304a",
  text: "#eae7f2",
  muted: "#9d95b3",
  accent: "#cdb9f5",
};

// Figtree is the product's face, but email cannot fetch a webfont, so this
// names it for the machines that already have it and falls back to each
// platform's own sans-serif. Mirrors the app's --font-sans.
const FONT = `"Figtree Variable", Figtree, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

// The one-time code stays monospace so its digits line up under the letter
// spacing. Mirrors the app's --font-mono.
const CODE_FONT = `ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Consolas, monospace`;

export interface EmailContent {
  /** The grey line inboxes show next to the subject. */
  preheader: string;
  heading: string;
  /** Plain text; escaped into the HTML part and used as-is in the text part. */
  paragraphs: string[];
  /** A code to read and retype, shown large and spaced. */
  code?: string;
  cta?: { label: string; url: string };
  /** Small print under the body, e.g. how long a link lasts. */
  note?: string;
  /** Leave out the sender and "Not you?" footer. It exists for mail someone
   * may not have asked for (codes, resets, notices); a letter to a person who
   * just signed up has no use for it. Defaults to shown. */
  footer?: boolean;
  /** A welcome-style layout: brand band, eyebrow, big centred heading, and a
   * sample (a long link and its short form) in a pill. For the one email that
   * should feel like a greeting; every other email keeps the plain layout. */
  hero?: { eyebrow: string; sample: { long: string; short: string } };
}

export interface EmailBody {
  html: SafeHtml;
  text: string;
}

/**
 * Hidden preview text. The zero-width joiners after it stop the client from
 * filling the rest of the preview line with the top of the message body.
 */
function preheaderBlock(preheader: string): SafeHtml {
  return emailHtml`<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${preheader}${"‌ ".repeat(60)}</div>`;
}

/**
 * A button that survives clients without CSS support: a bordered table cell
 * wrapping the anchor, rather than a styled <a> alone.
 */
function ctaBlock(cta: { label: string; url: string }): SafeHtml {
  return emailHtml`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
        <tr>
          <td class="cta" align="center" bgcolor="${LIGHT.accent}" style="border-radius:8px;background:${LIGHT.accent}">
            <a class="cta-link" href="${safeUrl(cta.url)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${cta.label}</a>
          </td>
        </tr>
      </table>`;
}

function codeBlock(code: string): SafeHtml {
  return emailHtml`<div class="code" style="margin:24px 0;padding:16px;border:1px solid ${LIGHT.border};border-radius:8px;background:${LIGHT.surface2};font-family:${CODE_FONT};font-size:30px;font-weight:700;letter-spacing:6px;text-align:center;color:${LIGHT.text}">${code}</div>`;
}

/** The plain layout's card rows: wordmark, heading, then the body. */
function plainRows(content: EmailContent, paragraphs: SafeHtml[]): SafeHtml {
  return emailHtml`        <tr>
          <td style="padding:26px 26px 0">
            <span class="wordmark" style="font-family:${FONT};font-size:15px;font-weight:700;letter-spacing:1px;color:${LIGHT.accent}">rdyrct</span>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 26px 0">
            <h1 class="text" style="margin:0 0 16px;font-family:${FONT};font-size:20px;line-height:1.35;font-weight:700;color:${LIGHT.text}">${content.heading}</h1>
          </td>
        </tr>
        <tr>
          <td class="text" style="padding:0 26px ${content.footer === false ? "12px" : "0"}">
            ${paragraphs}
            ${content.code ? codeBlock(content.code) : null}
            ${content.cta ? ctaBlock(content.cta) : null}
            ${
              content.note
                ? emailHtml`<p class="muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${LIGHT.muted}">${content.note}</p>`
                : null
            }
          </td>
        </tr>`;
}

/** The hero layout's card rows. Centred, with a brand band that stays dark in
 * both themes. The sample pill is decoration, not a code to retype. */
function heroRows(
  content: EmailContent,
  hero: NonNullable<EmailContent["hero"]>,
  appUrl: string,
): SafeHtml {
  const centred = (child: SafeHtml | string) =>
    emailHtml`<p class="text" style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:1.6;text-align:center;color:${LIGHT.text}">${child}</p>`;
  return emailHtml`<tr>
          <td class="band" align="center" bgcolor="${DARK.bg}" style="padding:22px 26px;background:${DARK.bg};border-radius:12px 12px 0 0">
            <img src="${`${appUrl}/email-logo.png`}" width="110" height="30" alt="rdyrct" style="display:inline-block;border:0;font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:2px;color:${DARK.text}">
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:30px 26px 0">
            <p class="eyebrow" style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${LIGHT.accent}">${hero.eyebrow}</p>
            <h1 class="text" style="margin:0 0 16px;font-family:${FONT};font-size:28px;line-height:1.25;font-weight:800;color:${LIGHT.text}">${content.heading}</h1>
          </td>
        </tr>
        <tr>
          <td class="text" style="padding:0 26px 12px">
            ${content.paragraphs.map(centred)}
            <div class="code" style="margin:22px 0;padding:16px;border:1px solid ${LIGHT.border};border-radius:10px;background:${LIGHT.surface2};text-align:center;font-family:${CODE_FONT};color:${LIGHT.text}">
              <div class="muted" style="font-size:13px;line-height:1.5;color:${LIGHT.muted};word-break:break-all">${hero.sample.long}</div>
              <div class="muted" style="font-size:16px;line-height:1.6;color:${LIGHT.muted}">&darr;</div>
              <div class="eyebrow" style="font-size:20px;font-weight:700;color:${LIGHT.accent}">${hero.sample.short}</div>
            </div>
            ${content.cta ? centredCta(content.cta) : null}
            ${
              content.note
                ? emailHtml`<div class="soft" style="margin:8px 0 12px;padding:16px 18px;border-radius:10px;background:${LIGHT.surface2}"><p class="text" style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${LIGHT.text}">${content.note}</p></div>`
                : null
            }
          </td>
        </tr>`;
}

/** The button, centred for the hero layout. */
function centredCta(cta: { label: string; url: string }): SafeHtml {
  return emailHtml`<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto">
        <tr>
          <td class="cta" align="center" bgcolor="${LIGHT.accent}" style="border-radius:8px;background:${LIGHT.accent}">
            <a class="cta-link" href="${safeUrl(cta.url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">${cta.label}</a>
          </td>
        </tr>
      </table>`;
}

/** Renders the HTML and plain-text parts of one email from the same content.
 * appUrl (env.APP_URL) signs the plain-text part with the sending instance,
 * so a self-hosted deploy signs its own mail rather than rdyrct.com's. `to`
 * is the one recipient this render is for: the footer states the plain fact
 * ("sent to X") rather than guessing at why, which was never something this
 * function actually knew. */
export function renderEmail(content: EmailContent, appUrl: string, to: string): EmailBody {
  // Every element that sets its own colour carries the matching class: an
  // inline colour beats an inherited one, so a dark-mode override on the
  // wrapping cell alone would leave these dark-on-dark.
  const paragraphs = content.paragraphs.map(
    (paragraph) =>
      emailHtml`<p class="text" style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${LIGHT.text}">${paragraph}</p>`,
  );

  const html = emailHtml`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${content.heading}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .body { background: ${DARK.bg} !important; }
    .card { background: ${DARK.surface} !important; border-color: ${DARK.border} !important; }
    .text { color: ${DARK.text} !important; }
    .muted { color: ${DARK.muted} !important; }
    .code { background: ${DARK.surface2} !important; border-color: ${DARK.border} !important; color: ${DARK.text} !important; }
    .cta { background: ${DARK.accent} !important; }
    .cta-link { color: ${DARK.bg} !important; }
    .wordmark { color: ${DARK.accent} !important; }
    .eyebrow { color: ${DARK.accent} !important; }
    .soft { background: ${DARK.surface2} !important; }
  }
</style>
</head>
<body class="body" style="margin:0;padding:0;background:${LIGHT.bg}">
${preheaderBlock(content.preheader)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="body" style="background:${LIGHT.bg}">
  <tr>
    <td align="center" style="padding:28px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="card" style="max-width:520px;background:${LIGHT.surface};border:1px solid ${LIGHT.border};border-radius:12px">
        ${content.hero ? heroRows(content, content.hero, appUrl) : plainRows(content, paragraphs)}
        ${
          content.footer === false
            ? null
            : emailHtml`<tr>
          <td style="padding:24px 26px 26px">
            <hr style="border:none;border-top:1px solid ${LIGHT.border};margin:0 0 14px">
            <p class="muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${LIGHT.muted}">rdyrct, link shortening and QR codes. Sent to ${to}. ${NOT_YOU}</p>
          </td>
        </tr>`
        }
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { html, text: renderText(content, appUrl, to) };
}

/** What to do with mail you did not expect, in both parts of every email. */
const NOT_YOU = "Not you? Ignore it, or write to support@mail.rdyrct.com.";

/**
 * The plain-text part. Not a fallback nobody reads: HTML-only mail is a
 * deliverability penalty, and text-only clients otherwise get nothing.
 */
function renderText(content: EmailContent, appUrl: string, to: string): string {
  const lines = [content.heading, "", ...content.paragraphs.flatMap((p) => [p, ""])];
  if (content.hero) {
    lines.unshift(content.hero.eyebrow.toUpperCase(), "");
    lines.push(`${content.hero.sample.long} -> ${content.hero.sample.short}`, "");
  }
  if (content.code) lines.push(content.code, "");
  if (content.cta) lines.push(`${content.cta.label}: ${safeUrl(content.cta.url)}`, "");
  if (content.note) lines.push(content.note, "");
  if (content.footer !== false) {
    lines.push("--", "rdyrct, link shortening and QR codes.", `Sent to ${to}.`, NOT_YOU, appUrl);
  }
  return lines.join("\n").trimEnd();
}
