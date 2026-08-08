import { describe, expect, test } from "bun:test";
import { renderEmail } from "../src/worker/email-layout";

const base = {
  preheader: "Join Acme on rdyrct.",
  heading: "You're invited to join Acme",
  paragraphs: ["rdyrct shortens links and makes QR codes for them."],
};

describe("renderEmail (#73)", () => {
  test("returns both parts from one call", () => {
    const { html, text } = renderEmail(base);
    expect(html.html).toContain("<!doctype html>");
    expect(text).toContain("You're invited to join Acme");
    expect(text).not.toContain("<");
  });

  test("puts the preheader before the body so inboxes preview it", () => {
    const { html } = renderEmail(base);
    const preheaderAt = html.html.indexOf("Join Acme on rdyrct.");
    const headingAt = html.html.indexOf("<h1");
    expect(preheaderAt).toBeGreaterThan(-1);
    expect(preheaderAt).toBeLessThan(headingAt);
  });

  test("hides the preheader from the rendered message", () => {
    // It belongs in the inbox preview line, not at the top of the email.
    expect(renderEmail(base).html.html).toContain("display:none");
  });

  test("escapes user-controlled content in both parts", () => {
    const hostile = `Acme</strong><a href="https://phish.example">click</a>`;
    const { html, text } = renderEmail({
      ...base,
      heading: `You're invited to join ${hostile}`,
      paragraphs: [hostile],
    });

    expect(html.html).not.toContain(`href="https://phish.example"`);
    // Exactly one anchor: the layout's own, and only when there is a CTA.
    expect(html.html.match(/<a\s/g) ?? []).toHaveLength(0);
    // The text part is not markup, so it carries the name as typed.
    expect(text).toContain(hostile);
  });

  test("renders a CTA as a link in HTML and a labelled URL in text", () => {
    const { html, text } = renderEmail({
      ...base,
      cta: { label: "Accept the invite", url: "https://rdyrct.com/invite/abc" },
    });

    expect(html.html).toContain(`href="https://rdyrct.com/invite/abc"`);
    expect(text).toContain("Accept the invite: https://rdyrct.com/invite/abc");
  });

  test("refuses a CTA URL that is not http(s) in both parts", () => {
    const { html, text } = renderEmail({
      ...base,
      cta: { label: "Go", url: "javascript:alert(1)" },
    });

    expect(html.html).not.toContain("javascript:");
    expect(text).not.toContain("javascript:");
  });

  test("puts a code on its own line in the text part", () => {
    const { html, text } = renderEmail({
      preheader: "123456 is your code.",
      heading: "Your verification code",
      paragraphs: ["Enter this code to finish signing in."],
      code: "123456",
      note: "The code expires in 10 minutes.",
    });

    expect(html.html).toContain("123456");
    // The e2e helper reads the code off a line of its own; keep it that way.
    expect(text).toMatch(/^123456$/m);
  });

  test("carries a sender footer in both parts", () => {
    const { html, text } = renderEmail(base);
    expect(html.html).toContain("rdyrct, link shortening and QR codes");
    expect(text).toContain("rdyrct, link shortening and QR codes.");
  });

  test("keeps a dark-mode block but styles light without it", () => {
    const { html } = renderEmail(base);
    expect(html.html).toContain("prefers-color-scheme: dark");
    // The light values are inline, so a client that drops <style> still reads.
    expect(html.html).toContain("background:#f7f4ef");
  });

  test("omits the code, CTA, and note blocks when unused", () => {
    const { html } = renderEmail(base);
    expect(html.html).not.toContain("letter-spacing:6px");
    expect(html.html).not.toContain("<a ");
    expect(html.html).not.toContain("undefined");
    expect(html.html).not.toContain("null");
  });
});
