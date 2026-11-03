/**
 * Addresses as people read them. Hosts are stored the way `URL` writes them
 * (an international domain as punycode, `xn--…`) and paths percent-encoded
 * (`%C3%9F`), which is right for a link and wrong for a label. These undo
 * both for display only: copy buttons and hrefs keep the raw value.
 */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;

/** The value of one punycode digit (a-z is 0-25, 0-9 is 26-35), or BASE
 * when the character is not a digit. */
function digitValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return BASE;
}

function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

/** RFC 3492 decoding of one label without its `xn--`, or null when the
 * label is not valid punycode. */
function decodeLabel(input: string): string | null {
  const out: number[] = [];
  const basic = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(basic, 0); j++) {
    const code = input.charCodeAt(j);
    if (code >= 128) return null;
    out.push(code);
  }
  let n = 128;
  let bias = 72;
  let i = 0;
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length;) {
    const before = i;
    let weight = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE) return null;
      i += digit * weight;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      weight *= BASE - t;
    }
    const length = out.length + 1;
    bias = adapt(i - before, length, before === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff) return null;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

/** "xn--bcher-kva.example" as "bücher.example". A label that does not
 * decode is left as it is. */
export function displayHost(host: string): string {
  return host
    .split(".")
    .map((label) =>
      label.toLowerCase().startsWith("xn--") ? (decodeLabel(label.slice(4)) ?? label) : label,
    )
    .join(".");
}

/** "/b%C3%A4ckerei" as "/bäckerei". Escapes that stand for a reserved
 * character (`%2F`, `%3F`) stay escaped, and a malformed one leaves the
 * whole path as it is. */
export function displayPath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/** A full address without its scheme, "kürzer.example/slug", for reading. */
export function displayAddress(url: string): string {
  try {
    const u = new URL(url);
    return `${displayHost(u.host)}${displayPath(u.pathname === "/" ? "" : u.pathname)}${displayPath(u.search)}`;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

/** A full URL, scheme included, with its host and path made readable. */
export function readableUrl(url: string): string {
  try {
    return `${new URL(url).protocol}//${displayAddress(url)}`;
  } catch {
    return url;
  }
}
