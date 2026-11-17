/**
 * Mail clients do not run script; the risk is markup and link injection into a
 * message sent from our domain with our SPF/DKIM behind it (#72). Only a SafeHtml
 * value, which exists solely as the tag's output, passes through as markup.
 */

export class SafeHtml {
  constructor(readonly html: string) {}
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escaping does not make `javascript:` or `data:` harmless in an attribute, so
 * the scheme is checked.
 */
export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "#";
  } catch {
    return "#";
  }
}

type Interpolated = SafeHtml | string | number | boolean | null | undefined | Interpolated[];

function render(value: Interpolated): string {
  if (value instanceof SafeHtml) return value.html;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

export function emailHtml(strings: TemplateStringsArray, ...values: Interpolated[]): SafeHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) out += render(values[i]) + (strings[i + 1] ?? "");
  return new SafeHtml(out);
}
