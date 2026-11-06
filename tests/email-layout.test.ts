import { describe, expect, test } from "bun:test";
import {
  type EmailBlock,
  NOTICE_FOOTER,
  blocksPreview,
  renderEmail,
} from "../src/worker/email-layout";

const APP_URL = "https://rdyrct.example";
const TO = "person@example.com";

const base = {
  preheader: "Join Acme on rdyrct.",
  heading: "You're invited to join Acme",
  paragraphs: ["rdyrct shortens links and makes QR codes for them."],
};

describe("renderEmail (#73)", () => {
  test("returns both parts from one call", () => {
    const { html, text } = renderEmail(base, APP_URL, TO);
    expect(html.html).toContain("<!doctype html>");
    expect(text).toContain("You're invited to join Acme");
    expect(text).not.toContain("<");
  });

  test("puts the preheader before the body so inboxes preview it", () => {
    const { html } = renderEmail(base, APP_URL, TO);
    const preheaderAt = html.html.indexOf("Join Acme on rdyrct.");
    const headingAt = html.html.indexOf("<h1");
    expect(preheaderAt).toBeGreaterThan(-1);
    expect(preheaderAt).toBeLessThan(headingAt);
  });

  test("pads the preheader with zero-width characters only, never a visible space", () => {
    const { html } = renderEmail(base, APP_URL, TO);
    const hidden = html.html.match(/width:0[^>]*>([^<]*)<\/div>/)?.[1] ?? "";
    expect(hidden.startsWith(base.preheader)).toBe(true);
    expect(hidden.slice(base.preheader.length)).toMatch(/^[͏‌]{100,}$/);
  });

  test("hides the preheader from the rendered message", () => {
    // It belongs in the inbox preview line, not at the top of the email.
    expect(renderEmail(base, APP_URL, TO).html.html).toContain("display:none");
  });

  test("escapes user-controlled content in both parts", () => {
    const hostile = `Acme</strong><a href="https://phish.example">click</a>`;
    const { html, text } = renderEmail(
      {
        ...base,
        heading: `You're invited to join ${hostile}`,
        paragraphs: [hostile],
      },
      APP_URL,
      TO,
    );

    expect(html.html).not.toContain(`href="https://phish.example"`);
    // Exactly one anchor: the layout's own, and only when there is a CTA.
    expect(html.html.match(/<a\s/g) ?? []).toHaveLength(0);
    // The text part is not markup, so it carries the name as typed.
    expect(text).toContain(hostile);
  });

  test("renders a CTA as a link in HTML and a labelled URL in text", () => {
    const { html, text } = renderEmail(
      {
        ...base,
        cta: { label: "Accept the invite", url: "https://rdyrct.com/invite/abc" },
      },
      APP_URL,
      TO,
    );

    expect(html.html).toContain(`href="https://rdyrct.com/invite/abc"`);
    expect(text).toContain("Accept the invite: https://rdyrct.com/invite/abc");
  });

  test("refuses a CTA URL that is not http(s) in both parts", () => {
    const { html, text } = renderEmail(
      {
        ...base,
        cta: { label: "Go", url: "javascript:alert(1)" },
      },
      APP_URL,
      TO,
    );

    expect(html.html).not.toContain("javascript:");
    expect(text).not.toContain("javascript:");
  });

  test("puts a code on its own line in the text part", () => {
    const { html, text } = renderEmail(
      {
        preheader: "123456 is your code.",
        heading: "Your verification code",
        paragraphs: ["Enter this code to finish signing in."],
        code: "123456",
        note: "The code expires in 10 minutes.",
      },
      APP_URL,
      TO,
    );

    expect(html.html).toContain("123456");
    // The e2e helper reads the code off a line of its own; keep it that way.
    expect(text).toMatch(/^123456$/m);
  });

  test("carries a sender footer in both parts", () => {
    const { html, text } = renderEmail(base, APP_URL, TO);
    expect(html.html).toContain("rdyrct, link shortening and QR codes");
    expect(text).toContain("rdyrct, link shortening and QR codes.");
  });

  test("leaves the footer out of both parts when asked, and nothing else", () => {
    const { html, text } = renderEmail({ ...base, footer: false }, APP_URL, TO);
    for (const part of [html.html, text]) {
      expect(part).not.toContain("rdyrct, link shortening and QR codes");
      expect(part).not.toContain("Not you?");
      expect(part).not.toContain(`Sent to ${TO}`);
    }
    expect(text).toContain(base.heading);
    expect(text.endsWith("\n")).toBe(false);
  });

  test("renders the hero layout in both parts, and leaves the plain layout alone", () => {
    const hero = {
      eyebrow: "Welcome to rdyrct",
      sample: { long: "https://example.com/long", short: "rdyr.cc/hello" },
    };
    const { html, text } = renderEmail({ ...base, hero, footer: false }, APP_URL, TO);
    expect(html.html).toContain("Welcome to rdyrct");
    // Gmail linkifies a bare host; a zero-width space after each dot stops it.
    expect(html.html).toContain("rdyr.​cc/hello");
    expect(html.html).not.toContain("rdyr.cc/hello");
    expect(html.html).toContain('class="band"');
    expect(text).toContain("WELCOME TO RDYRCT");
    expect(text).toContain("https://example.com/long -> rdyr.cc/hello");
    // Both layouts open with the same brand band.
    expect(renderEmail(base, APP_URL, TO).html.html).toContain('class="band"');

    const bare = renderEmail(
      { ...base, hero: { sample: hero.sample }, footer: false },
      APP_URL,
      TO,
    );
    expect(bare.html.html).not.toContain("text-transform:uppercase");
    expect(bare.text.startsWith(base.heading)).toBe(true);
  });

  test("puts the brand image first in every layout, with the word as its alt text", () => {
    const { html } = renderEmail(base, APP_URL, TO);
    expect(html.html).toContain(`src="${APP_URL}/email-logo.png"`);
    expect(html.html).toContain('alt="rdyrct"');
  });

  test("swaps the footer advice for mail about the reader's own account", () => {
    const { html, text } = renderEmail({ ...base, footerLine: NOTICE_FOOTER }, APP_URL, TO);
    for (const part of [html.html, text]) {
      expect(part).toContain(NOTICE_FOOTER);
      expect(part).not.toContain("Not you?");
      expect(part).toContain(`Sent to ${TO}`);
    }
  });

  test("states the recipient as a plain fact, not a guessed reason", () => {
    const { html, text } = renderEmail(base, APP_URL, TO);
    expect(html.html).toContain(`Sent to ${TO}.`);
    expect(text).toContain(`Sent to ${TO}.`);
  });

  test("says where to go when the mail was not expected, in both parts", () => {
    const { html, text } = renderEmail(base, APP_URL, TO);
    expect(html.html).toContain("Not you? Ignore it, or write to support@mail.rdyrct.com.");
    expect(text).toContain("Not you? Ignore it, or write to support@mail.rdyrct.com.");
  });

  test("keeps a dark-mode block but styles light without it", () => {
    const { html } = renderEmail(base, APP_URL, TO);
    expect(html.html).toContain("prefers-color-scheme: dark");
    // The light values are inline, so a client that drops <style> still reads.
    expect(html.html).toContain("background:#f7f4ef");
  });

  test("omits the code, CTA, and note blocks when unused", () => {
    const { html } = renderEmail(base, APP_URL, TO);
    expect(html.html).not.toContain("letter-spacing:6px");
    expect(html.html).not.toContain("<a ");
    expect(html.html).not.toContain("undefined");
    expect(html.html).not.toContain("null");
  });
});

describe("renderEmail unsubscribe slot", () => {
  const link = "https://rdyrct.example/unsubscribe?t=abc.def";

  test("puts the reader's unsubscribe link in the footer of both parts", () => {
    const { html, text } = renderEmail({ ...base, unsubscribeUrl: link }, APP_URL, TO);
    expect(html.html).toContain(`href="${link}"`);
    expect(html.html).toContain("Unsubscribe</a>");
    expect(text).toContain(`Unsubscribe: ${link}`);
  });

  test("adds nothing to mail that has no such link", () => {
    const { html, text } = renderEmail(base, APP_URL, TO);
    expect(html.html).not.toContain("Unsubscribe");
    expect(text).not.toContain("Unsubscribe");
  });

  test("refuses a link that is not http(s)", () => {
    const { html } = renderEmail({ ...base, unsubscribeUrl: "javascript:alert(1)" }, APP_URL, TO);
    expect(html.html).not.toContain("javascript:");
  });

  test("prints the postal address under the link, in both parts", () => {
    const postalAddress = "rdyrct, 1 Example <Street>, Rome";
    const { html, text } = renderEmail(
      { ...base, unsubscribeUrl: link, postalAddress },
      APP_URL,
      TO,
    );
    expect(html.html).toContain("rdyrct, 1 Example &lt;Street&gt;, Rome");
    expect(html.html.indexOf("Example &lt;Street")).toBeGreaterThan(
      html.html.indexOf("Unsubscribe</a>"),
    );
    expect(text).toContain(`Unsubscribe: ${link}\n${postalAddress}`);
  });

  test("leaves the postal address out of mail with no unsubscribe link", () => {
    const { html, text } = renderEmail({ ...base, postalAddress: "1 Example Street" }, APP_URL, TO);
    expect(html.html).not.toContain("1 Example Street");
    expect(text).not.toContain("1 Example Street");
  });
});

describe("renderEmail blocks slot", () => {
  const blocks: EmailBlock[] = [
    { kind: "heading", level: 2, content: [{ text: "Big <script>alert(1)</script>" }] },
    { kind: "heading", level: 3, content: [{ text: "Small one" }] },
    {
      kind: "paragraph",
      content: [
        { text: "Hi " },
        { text: "bold", bold: true },
        { text: " " },
        { text: "it", italic: true },
        { text: " " },
        { text: "un", underline: true },
        { lineBreak: true },
        { text: "docs", href: "https://rdyrct.com/docs" },
        { text: " and " },
        { text: "bad", href: "javascript:alert(1)" },
      ],
    },
    {
      kind: "list",
      ordered: false,
      items: [
        [{ kind: "paragraph", content: [{ text: "one" }] }],
        [{ kind: "paragraph", content: [{ text: "two" }] }],
      ],
    },
    {
      kind: "list",
      ordered: true,
      start: 3,
      items: [[{ kind: "paragraph", content: [{ text: "third" }] }]],
    },
    { kind: "divider" },
    { kind: "button", label: "Open it", url: "https://rdyrct.com/x" },
    { kind: "button", label: "Evil", url: "javascript:alert(1)" },
  ];
  const { html, text } = renderEmail({ ...base, paragraphs: [], blocks }, APP_URL, TO);

  test("renders each block with escaping", () => {
    expect(html.html).toContain("<h2");
    expect(html.html).toContain("Big &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html.html).not.toContain("<script>");
    expect(html.html).toContain("<h3");
    expect(html.html).toContain("<strong>bold</strong>");
    expect(html.html).toContain("<em>it</em>");
    expect(html.html).toContain("<u>un</u>");
    expect(html.html).toContain("<br>");
    expect(html.html).toMatch(/<a class="link" href="https:\/\/rdyrct.com\/docs"[^>]*>docs<\/a>/);
    expect(html.html).toMatch(/<ul class="text"[^>]*><li[^>]*><span>one<\/span><\/li>/);
    expect(html.html).toContain('<ol class="text" start="3"');
    expect(html.html).toContain('<hr class="rule"');
    expect(html.html).toMatch(/class="cta-link" href="https:\/\/rdyrct.com\/x"[^>]*>Open it</);
  });

  test("drops a javascript: link and button, keeping the link's text", () => {
    expect(html.html).not.toContain("javascript:");
    expect(html.html).toContain(" and bad");
    expect(html.html).not.toContain("Evil");
    expect(text).not.toContain("javascript:");
    expect(text).not.toContain("Evil");
  });

  test("writes the same document into the text part", () => {
    const body = text.slice(text.indexOf("Big"), text.indexOf("\n--"));
    expect(body).toBe(
      [
        "Big <script>alert(1)</script>",
        "",
        "Small one",
        "",
        "Hi bold it un",
        "docs (https://rdyrct.com/docs) and bad",
        "",
        "- one",
        "- two",
        "",
        "3. third",
        "",
        "* * *",
        "",
        "Open it: https://rdyrct.com/x",
        "",
        "",
      ].join("\n"),
    );
  });

  test("previews the first text for the preheader, without buttons", () => {
    expect(blocksPreview(blocks)).toBe(
      "Big <script>alert(1)</script> Small one Hi bold it un docs (https://rdyrct.com/docs) and bad - one - two 3. third",
    );
    expect(blocksPreview(blocks, 20)).toBe("Big <script>alert(1…");
  });
});

describe("renderEmail in Outlook", () => {
  test("holds the card to 520px in a ghost table only Outlook reads", () => {
    const { html } = renderEmail(base, APP_URL, TO);
    expect(html.html).toContain(
      `<!--[if mso]><table role="presentation" width="520" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`,
    );
    expect(html.html).toContain("<!--[if mso]></td></tr></table><![endif]-->");
    const opens = html.html.indexOf("<!--[if mso]><table");
    const card = html.html.indexOf(`class="card"`);
    const closes = html.html.indexOf("<!--[if mso]></td></tr></table>");
    expect(opens).toBeLessThan(card);
    expect(card).toBeLessThan(closes);
  });

  test("gives Outlook a VML button that is a link edge to edge, and hides the table one", () => {
    const url = "https://rdyrct.com/x";
    for (const hero of [
      undefined,
      { sample: { long: "https://a.example/long", short: "r.dy/a" } },
    ]) {
      const { html } = renderEmail(
        { ...base, hero, cta: { label: "Open <it>", url } },
        APP_URL,
        TO,
      );
      expect(html.html).toMatch(
        /<!--\[if mso\]><v:roundrect [^>]*href="https:\/\/rdyrct.com\/x"[^>]*>.*Open &lt;it&gt;<\/center><\/v:roundrect><!\[endif\]-->/,
      );
      expect(html.html).toMatch(
        /<!--\[if !mso\]><!--><table[^]*class="cta-link"[^]*<!--<!\[endif\]-->/,
      );
    }
  });

  test("puts no VML in a JavaScript link", () => {
    const { html } = renderEmail(
      { ...base, cta: { label: "Go", url: "javascript:alert(1)" } },
      APP_URL,
      TO,
    );
    expect(html.html).not.toContain("javascript:");
  });
});
