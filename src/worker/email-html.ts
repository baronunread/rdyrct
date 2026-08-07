/**
 * HTML escaping for outbound email.
 *
 * Org names and display names reach these templates straight from user
 * input, and an invite email is one an attacker both writes into and picks
 * the recipient of. Mail clients do not run script, so the risk is not code
 * execution: it is markup and link injection into a message that arrives
 * from our sending domain with our SPF/DKIM alignment behind it (#72).
 *
 * The defence is the `emailHtml` tag, not a rule each call site remembers.
 * Interpolating a plain string escapes it; only a SafeHtml value, which
 * exists solely as the tag's own output, passes through as markup.
 */

/** Markup that has already been through the tag, so it is safe to embed. */
export class SafeHtml {
  constructor(readonly html: string) {}
}

/**
 * Escapes the five characters that let a value break out of text or a
 * quoted attribute. Both quote styles are covered, so one helper serves
 * `<p>${value}</p>` and `href="${value}"` alike.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A URL safe to put in an href, or "#" for anything that is not http(s).
 *
 * Escaping alone does not make `javascript:` or `data:` harmless in an
 * attribute, so the scheme is checked rather than encoded. Every URL we
 * send today is one we built, which is exactly why this should be enforced
 * here: the next one might not be.
 */
export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "#";
  } catch {
    return "#";
  }
}

/** Renders one interpolated value: safe markup as-is, everything else escaped. */
function render(value: unknown): string {
  if (value instanceof SafeHtml) return value.html;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

/**
 * Tagged template for email markup: `emailHtml`<p>Hi ${name}</p>``.
 *
 * The literal parts are trusted (they are in this repo); the interpolations
 * are not, and are escaped unless they are SafeHtml.
 */
export function emailHtml(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) out += render(values[i]) + (strings[i + 1] ?? "");
  return new SafeHtml(out);
}
