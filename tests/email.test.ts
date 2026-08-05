import { describe, expect, test } from "bun:test";
import { renderEmail, escapeHtml, p, button, code } from "../src/worker/email";

describe("renderEmail", () => {
  test("returns both an HTML and a plain-text body", () => {
    const { html, text } = renderEmail({
      heading: "Your verification code",
      preheader: "Your rdyrct verification code. It expires in 10 minutes.",
      blocks: [
        p("Your rdyrct verification code is:"),
        code("123456"),
        p("It expires in 10 minutes."),
      ],
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("123456");
    // The text part carries the same information without markup.
    expect(text).toContain("Your verification code");
    expect(text).toContain("123456");
    expect(text).not.toContain("<");
  });

  test("opens the HTML with the preheader for the inbox preview", () => {
    const { html } = renderEmail({
      heading: "You're invited",
      preheader: "Join Acme on rdyrct.",
      blocks: [p("hi")],
    });
    // The preheader is a hidden span placed before the visible layout table.
    expect(html).toContain("Join Acme on rdyrct.");
    expect(html.indexOf("Join Acme on rdyrct.")).toBeLessThan(
      html.indexOf('<table role="presentation"'),
    );
    expect(html).toContain("display:none");
  });

  test("renders a button as a link in HTML and label: url in text", () => {
    const { html, text } = renderEmail({
      heading: "Reset your password",
      preheader: "Reset it.",
      blocks: [button("Reset your password", "https://rdyrct.com/reset?token=abc")],
    });
    expect(html).toContain('href="https://rdyrct.com/reset?token=abc"');
    expect(text).toContain("Reset your password: https://rdyrct.com/reset?token=abc");
  });

  test("escapes interpolated values so a name or org can't inject markup", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const { html, text } = renderEmail({
      heading: "You're invited",
      preheader: evil,
      blocks: [p(`Hi ${evil},`)],
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    // The raw text part keeps the value verbatim (nothing renders it as markup).
    expect(text).toContain(evil);
  });

  test("escapeHtml covers the five markup-significant characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});
