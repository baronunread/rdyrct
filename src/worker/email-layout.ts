import { type SafeHtml, emailHtml, safeUrl } from "./email-html";
import { SUPPORT_EMAIL } from "@/shared/support";

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

/** A run of text inside a block, or a line break. A link is http(s) only:
 * anything else renders as its text alone. */
export type EmailInline =
  | { text: string; bold?: boolean; italic?: boolean; underline?: boolean; href?: string }
  | { lineBreak: true };

/** One block of a written email (the newsletter editor's output, parsed in
 * worker/newsletter-doc.ts). Rendered with the same styles as paragraphs. */
export type EmailBlock =
  | { kind: "paragraph"; content: EmailInline[] }
  | { kind: "heading"; level: 2 | 3; content: EmailInline[] }
  | { kind: "list"; ordered: boolean; start?: number; items: EmailBlock[][] }
  | { kind: "divider" }
  | { kind: "button"; label: string; url: string };

export interface EmailContent {
  /** The grey line inboxes show next to the subject. */
  preheader: string;
  heading: string;
  /** Plain text; escaped into the HTML part and used as-is in the text part. */
  paragraphs: string[];
  /** Written blocks after the paragraphs: headings, lists, links, a divider,
   * buttons. Every string in them is escaped like a paragraph. */
  blocks?: EmailBlock[];
  /** A code to read and retype, shown large and spaced. */
  code?: string;
  cta?: { label: string; url: string };
  /** Small print under the body, e.g. how long a link lasts. */
  note?: string;
  /** Leave out the sender and "Not you?" footer. It exists for mail someone
   * may not have asked for (codes, resets, notices); a letter to a person who
   * just signed up has no use for it. Defaults to shown. */
  footer?: boolean;
  /** What the footer says after "Sent to you." Defaults to the advice for mail
   * you may not have asked for (ignore it). Mail about the reader's own
   * account, where ignoring it is bad advice, passes NOTICE_FOOTER. */
  footerLine?: string;
  /** Marketing mail only: this reader's own unsubscribe link, shown in the
   * footer of both parts. Needs the footer, so it is ignored with footer
   * false. */
  unsubscribeUrl?: string;
  /** The sender's postal address (env.POSTAL_ADDRESS), shown under the
   * unsubscribe link in both parts. Marketing mail must carry one
   * (CAN-SPAM), so it only shows with `unsubscribeUrl`. */
  postalAddress?: string;
  /** A welcome-style layout: brand band, eyebrow, big centred heading, and a
   * sample (a long link and its short form) in a pill. For the one email that
   * should feel like a greeting; every other email keeps the plain layout. */
  hero?: { eyebrow?: string; sample: { long: string; short: string } };
}

export interface EmailBody {
  html: SafeHtml;
  text: string;
}

/**
 * Hidden preview text. The invisible characters after it stop the client from
 * filling the rest of the preview line with the top of the message body. They
 * must be zero-width: a no-break space shows as a visible gap in Gmail's list.
 */
function preheaderBlock(preheader: string): SafeHtml {
  return emailHtml`<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;mso-hide:all">${preheader}${"\u034f\u200c".repeat(100)}</div>`;
}

/** A zero-width space after each dot and colon keeps Gmail from turning the
 * sample links into blue underlined ones. They are decoration, not links. */
function noAutolink(text: string): string {
  return text.replace(/[.:]/g, (mark) => `${mark}\u200b`);
}

/** A button's size: padding around the label, and the label's type. */
interface ButtonSize {
  padY: number;
  padX: number;
  fontSize: number;
  weight: number;
}

const BUTTON = { padY: 12, padX: 22, fontSize: 15, weight: 600 } satisfies ButtonSize;
const HERO_BUTTON = { padY: 14, padX: 28, fontSize: 16, weight: 700 } satisfies ButtonSize;

/**
 * Outlook for Windows ignores padding on a link, so the coloured cell around
 * it would be a button whose edges do nothing. It gets a VML shape instead:
 * the whole shape is the link. Its width is a guess from the label's length
 * (VML cannot size to its text), generous so the label never wraps.
 */
function outlookButton(cta: { label: string; url: string }, size: ButtonSize): SafeHtml {
  const height = Math.round(size.fontSize * 1.5) + 2 * size.padY;
  const width = Math.ceil(cta.label.length * size.fontSize * 0.62) + 2 * size.padX;
  return emailHtml`<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl(cta.url)}" style="height:${height}px;v-text-anchor:middle;width:${width}px" arcsize="18%" stroke="f" fillcolor="${LIGHT.accent}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:${size.fontSize}px;font-weight:${size.weight}">${cta.label}</center></v:roundrect><![endif]-->`;
}

/**
 * A button that survives clients without CSS support: a bordered table cell
 * wrapping the anchor, rather than a styled <a> alone. Outlook gets the VML
 * shape above in its place.
 */
function buttonTable(
  cta: { label: string; url: string },
  size: ButtonSize,
  centred: boolean,
): SafeHtml {
  return emailHtml`${outlookButton(cta, size)}<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" border="0"${centred ? emailHtml` align="center"` : null} style="margin:${centred ? "24px auto" : "24px 0"}">
        <tr>
          <td class="cta" align="center" bgcolor="${LIGHT.accent}" style="border-radius:8px;background:${LIGHT.accent}">
            <a class="cta-link" href="${safeUrl(cta.url)}" style="display:inline-block;padding:${size.padY}px ${size.padX}px;font-family:${FONT};font-size:${size.fontSize}px;font-weight:${size.weight};color:#ffffff;text-decoration:none">${cta.label}</a>
          </td>
        </tr>
      </table><!--<![endif]-->`;
}

function ctaBlock(cta: { label: string; url: string }): SafeHtml {
  return buttonTable(cta, BUTTON, false);
}

const PARAGRAPH_STYLE = `margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${LIGHT.text}`;

/** One run of text. A link that is not http(s) keeps its text and loses the
 * link: safeUrl's "#" would leave a dead link in the email. */
function inlineHtml(run: EmailInline): SafeHtml {
  if ("lineBreak" in run) return emailHtml`<br>`;
  let out = emailHtml`${run.text}`;
  if (run.bold) out = emailHtml`<strong>${out}</strong>`;
  if (run.italic) out = emailHtml`<em>${out}</em>`;
  if (run.underline) out = emailHtml`<u>${out}</u>`;
  const href = run.href ? safeUrl(run.href) : "#";
  if (href !== "#") {
    out = emailHtml`<a class="link" href="${href}" style="color:${LIGHT.accent};text-decoration:underline">${out}</a>`;
  }
  return out;
}

type HeadingBlock = Extract<EmailBlock, { kind: "heading" }>;
type ListBlock = Extract<EmailBlock, { kind: "list" }>;

/** A heading inside the body: smaller than the email's own h1. */
function headingHtml(block: HeadingBlock): SafeHtml {
  const runs = block.content.map(inlineHtml);
  return block.level === 2
    ? emailHtml`<h2 class="text" style="margin:22px 0 10px;font-family:${FONT};font-size:18px;line-height:1.35;font-weight:700;color:${LIGHT.text}">${runs}</h2>`
    : emailHtml`<h3 class="text" style="margin:18px 0 8px;font-family:${FONT};font-size:16px;line-height:1.4;font-weight:700;color:${LIGHT.text}">${runs}</h3>`;
}

function listHtml(block: ListBlock): SafeHtml {
  const items = block.items.map(
    (item) =>
      emailHtml`<li class="text" style="margin:0 0 6px;font-family:${FONT};font-size:15px;line-height:1.6;color:${LIGHT.text}">${item.map(listItemBlock)}</li>`,
  );
  const style = `margin:0 0 14px;padding:0 0 0 22px;font-family:${FONT};font-size:15px;line-height:1.6;color:${LIGHT.text}`;
  return block.ordered
    ? emailHtml`<ol class="text" start="${block.start ?? 1}" style="${style}">${items}</ol>`
    : emailHtml`<ul class="text" style="${style}">${items}</ul>`;
}

/** One written block, styled like the layout's own paragraphs and button. */
function blockHtml(block: EmailBlock): SafeHtml | null {
  switch (block.kind) {
    case "paragraph":
      return emailHtml`<p class="text" style="${PARAGRAPH_STYLE}">${block.content.map(inlineHtml)}</p>`;
    case "heading":
      return headingHtml(block);
    case "list":
      return listHtml(block);
    case "divider":
      return emailHtml`<hr class="rule" style="border:none;border-top:1px solid ${LIGHT.border};margin:22px 0">`;
    case "button":
      return safeUrl(block.url) === "#" ? null : ctaBlock(block);
  }
}

/** Inside a list item a paragraph drops its bottom margin, so the bullets
 * keep the list's own spacing. */
function listItemBlock(block: EmailBlock): SafeHtml | null {
  if (block.kind !== "paragraph") return blockHtml(block);
  return emailHtml`<span>${block.content.map(inlineHtml)}</span>`;
}

function codeBlock(code: string): SafeHtml {
  return emailHtml`<div class="code" style="margin:24px 0;padding:16px;border:1px solid ${LIGHT.border};border-radius:8px;background:${LIGHT.surface2};font-family:${CODE_FONT};font-size:30px;font-weight:700;letter-spacing:6px;text-align:center;color:${LIGHT.text}">${code}</div>`;
}

/** The brand band across the top of every email: the Hop mark and the
 * wordmark, outlined from Figtree Bold, on a band that stays dark in both
 * themes. The image's alt text carries the word in the same colour if a client
 * blocks images. */
function bandRow(appUrl: string): SafeHtml {
  return emailHtml`<tr>
          <td class="band" align="center" bgcolor="${DARK.bg}" style="padding:22px 26px;background:${DARK.bg};border-radius:12px 12px 0 0">
            <img src="${`${appUrl}/email-logo.png`}" width="106" height="32" alt="rdyrct" style="display:inline-block;border:0;font-family:${FONT};font-size:22px;font-weight:700;color:${DARK.text}">
          </td>
        </tr>`;
}

/** The plain layout's card rows: band, heading, then the body. */
function plainRows(content: EmailContent, paragraphs: SafeHtml[], appUrl: string): SafeHtml {
  return emailHtml`        ${bandRow(appUrl)}
        <tr>
          <td style="padding:24px 26px 0">
            <h1 class="text" style="margin:0 0 16px;font-family:${FONT};font-size:20px;line-height:1.35;font-weight:700;color:${LIGHT.text}">${content.heading}</h1>
          </td>
        </tr>
        <tr>
          <td class="text" style="padding:0 26px ${content.footer === false ? "12px" : "0"}">
            ${paragraphs}
            ${content.blocks ? content.blocks.map(blockHtml) : null}
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
  return emailHtml`${bandRow(appUrl)}
        <tr>
          <td align="center" style="padding:${hero.eyebrow ? "30px" : "28px"} 26px 0">
            ${hero.eyebrow ? emailHtml`<p class="eyebrow" style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${LIGHT.accent}">${hero.eyebrow}</p>` : null}
            <h1 class="text" style="margin:0 0 16px;font-family:${FONT};font-size:28px;line-height:1.25;font-weight:800;color:${LIGHT.text}">${content.heading}</h1>
          </td>
        </tr>
        <tr>
          <td class="text" style="padding:0 26px 12px">
            ${content.paragraphs.map(centred)}
            <div class="code" style="margin:22px 0;padding:16px;border:1px solid ${LIGHT.border};border-radius:10px;background:${LIGHT.surface2};text-align:center;font-family:${CODE_FONT};color:${LIGHT.text}">
              <div class="muted" style="font-size:13px;line-height:1.5;color:${LIGHT.muted};word-break:break-all">${noAutolink(hero.sample.long)}</div>
              <div class="muted" style="font-size:16px;line-height:1.6;color:${LIGHT.muted}">&darr;</div>
              <div class="eyebrow" style="font-size:20px;font-weight:700;color:${LIGHT.accent}">${noAutolink(hero.sample.short)}</div>
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
  return buttonTable(cta, HERO_BUTTON, true);
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
    .eyebrow { color: ${DARK.accent} !important; }
    .soft { background: ${DARK.surface2} !important; }
    .link { color: ${DARK.accent} !important; }
    .rule { border-top-color: ${DARK.border} !important; }
  }
</style>
</head>
<body class="body" style="margin:0;padding:0;background:${LIGHT.bg}">
${preheaderBlock(content.preheader)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="body" style="background:${LIGHT.bg}">
  <tr>
    <td align="center" style="padding:28px 16px">
      <!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="card" style="max-width:520px;background:${LIGHT.surface};border:1px solid ${LIGHT.border};border-radius:12px">
        ${content.hero ? heroRows(content, content.hero, appUrl) : plainRows(content, paragraphs, appUrl)}
        ${
          content.footer === false
            ? null
            : emailHtml`<tr>
          <td style="padding:24px 26px 26px">
            <hr class="rule" style="border:none;border-top:1px solid ${LIGHT.border};margin:0 0 14px">
            <p class="muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${LIGHT.muted}">rdyrct, link shortening and QR codes. Sent to ${to}. ${content.footerLine ?? NOT_YOU}${content.unsubscribeUrl ? emailHtml` <a class="muted" href="${safeUrl(content.unsubscribeUrl)}" style="color:${LIGHT.muted};text-decoration:underline">Unsubscribe</a>.` : null}</p>
            ${content.unsubscribeUrl && content.postalAddress ? emailHtml`<p class="muted" style="margin:6px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${LIGHT.muted}">${content.postalAddress}</p>` : null}
          </td>
        </tr>`
        }
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;

  return { html, text: renderText(content, appUrl, to) };
}

export { SUPPORT_EMAIL };

/** What to do with mail you did not expect, in both parts of every email. */
const NOT_YOU = `Not you? Ignore it, or write to ${SUPPORT_EMAIL}.`;

/** The footer line for mail about the reader's own account. */
export const NOTICE_FOOTER = `Questions? Write to ${SUPPORT_EMAIL}.`;

/**
 * The plain-text part. Not a fallback nobody reads: HTML-only mail is a
 * deliverability penalty, and text-only clients otherwise get nothing.
 */
function renderText(content: EmailContent, appUrl: string, to: string): string {
  const lines = [
    content.heading,
    "",
    ...content.paragraphs.flatMap((p) => [p, ""]),
    ...blocksText(content.blocks),
  ];
  if (content.hero) {
    if (content.hero.eyebrow) lines.unshift(content.hero.eyebrow.toUpperCase(), "");
    lines.push(`${content.hero.sample.long} -> ${content.hero.sample.short}`, "");
  }
  if (content.code) lines.push(content.code, "");
  if (content.cta) lines.push(`${content.cta.label}: ${safeUrl(content.cta.url)}`, "");
  if (content.note) lines.push(content.note, "");
  if (content.footer !== false) {
    lines.push(
      "--",
      "rdyrct, link shortening and QR codes.",
      `Sent to ${to}.`,
      content.footerLine ?? NOT_YOU,
      ...(content.unsubscribeUrl ? [`Unsubscribe: ${safeUrl(content.unsubscribeUrl)}`] : []),
      ...(content.unsubscribeUrl && content.postalAddress ? [content.postalAddress] : []),
      appUrl,
    );
  }
  return lines.join("\n").trimEnd();
}

/** A run of text in the plain part: a link as "text (url)", or the url alone
 * when the text is the url. */
function inlineText(content: EmailInline[]): string {
  return content
    .map((run) => {
      if ("lineBreak" in run) return "\n";
      const href = run.href ? safeUrl(run.href) : "#";
      if (href === "#" || run.text === run.href || run.text === href) return run.text;
      return `${run.text} (${href})`;
    })
    .join("");
}

/** One block as plain-text lines; `indent` nests a list inside a list. */
function blockText(block: EmailBlock, indent: string): string[] {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return inlineText(block.content)
        .split("\n")
        .map((line) => indent + line);
    case "list":
      return block.items.flatMap((item, i) => {
        const marker = block.ordered ? `${(block.start ?? 1) + i}. ` : "- ";
        const [first, ...rest] = item.flatMap((child) => blockText(child, ""));
        const pad = indent + " ".repeat(marker.length);
        return [indent + marker + (first ?? "").trimStart(), ...rest.map((line) => pad + line)];
      });
    case "divider":
      // Not "---": a line starting "--" is where the signature begins.
      return [indent + "* * *"];
    case "button":
      return safeUrl(block.url) === "#" ? [] : [`${indent}${block.label}: ${safeUrl(block.url)}`];
  }
}

/** The written blocks as plain-text lines, a blank line after each. */
function blocksText(blocks: EmailBlock[] = []): string[] {
  return blocks.flatMap((block) => [...blockText(block, ""), ""]);
}

/** The blocks' text in reading order, for a preheader. */
export function blocksPreview(blocks: EmailBlock[], length = 120): string {
  const text = blocks
    .flatMap((block) =>
      block.kind === "divider" || block.kind === "button" ? [] : blockText(block, ""),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}
