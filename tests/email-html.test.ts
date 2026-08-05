import { describe, expect, test } from "bun:test";
import { SafeHtml, emailHtml, escapeHtml, safeUrl } from "../src/worker/email-html";

describe("escapeHtml", () => {
  test("escapes the characters that end text content or an attribute", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  test("leaves ordinary text alone", () => {
    expect(escapeHtml("Acme Corp (EU)")).toBe("Acme Corp (EU)");
  });
});

describe("safeUrl", () => {
  test.each([
    ["https://rdyrct.com/invite/abc", "https://rdyrct.com/invite/abc"],
    ["http://localhost:5173/invite/abc", "http://localhost:5173/invite/abc"],
  ])("keeps %s", (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });

  test.each([["javascript:alert(1)"], ["data:text/html,<script>x</script>"], ["not a url"], [""]])(
    "refuses %s rather than encoding it",
    (input) => {
      expect(safeUrl(input)).toBe("#");
    },
  );
});

describe("emailHtml (#72)", () => {
  test("escapes an interpolated value", () => {
    const orgName = `<a href="https://evil.example">Acme</a>`;
    const out = emailHtml`<p>Join <strong>${orgName}</strong>.</p>`;

    expect(out.html).toBe(
      "<p>Join <strong>&lt;a href=&quot;https://evil.example&quot;&gt;Acme&lt;/a&gt;</strong>.</p>",
    );
    expect(out.html).not.toContain("<a href");
  });

  test("keeps the literal parts of the template as markup", () => {
    expect(emailHtml`<p>Hi ${"Ada"},</p>`.html).toBe("<p>Hi Ada,</p>");
  });

  test("passes SafeHtml through, so fragments can nest", () => {
    const inner = emailHtml`<em>${"Ada & Co"}</em>`;
    expect(emailHtml`<p>${inner}</p>`.html).toBe("<p><em>Ada &amp; Co</em></p>");
  });

  test("renders an array of fragments in order", () => {
    const items = ["a<", "b&"].map((text) => emailHtml`<li>${text}</li>`);
    expect(emailHtml`<ul>${items}</ul>`.html).toBe("<ul><li>a&lt;</li><li>b&amp;</li></ul>");
  });

  test("renders null and undefined as nothing, not as their names", () => {
    expect(emailHtml`<p>${null}${undefined}</p>`.html).toBe("<p></p>");
  });

  test("returns SafeHtml, which is what sendEmail will accept", () => {
    expect(emailHtml`<p>x</p>`).toBeInstanceOf(SafeHtml);
  });

  test("a hostile org name cannot open an anchor in the invite body", () => {
    // The shape of the real attack: a link the recipient did not expect,
    // inside a message our domain signed.
    const orgName = `Acme</strong><a href="https://phish.example">Click to keep access`;
    const out = emailHtml`<p>You've been invited to join <strong>${orgName}</strong>.</p>`;

    expect(out.html).not.toContain('phish.example"');
    expect(out.html).not.toMatch(/<a\s/);
  });

  test("a hostile display name cannot inject markup into the reset email", () => {
    const name = `Ada<img src=x onerror="steal()">`;
    expect(emailHtml`<p>Hi ${name},</p>`.html).not.toMatch(/<img/);
  });
});
