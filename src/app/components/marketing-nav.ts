/**
 * The pages the marketing header leads to, shared by the desktop pill and the
 * phone menu so the two cannot list different places.
 */

/** What "Product" opens. Each says in a few words why you would go there. */
export const PRODUCT_LINKS = [
  { to: "/branded-link-shortener", label: "Branded links", hint: "On your own domain" },
  { to: "/qr-code-generator", label: "QR code generator", hint: "Free, with your logo" },
  { to: "/utm-builder", label: "UTM builder", hint: "Tag a link for analytics" },
  { to: "/compare", label: "Compare", hint: "Against Bitly, Rebrandly, Dub" },
  { to: "/roadmap", label: "Roadmap", hint: "What we build next" },
  { to: "/changelog", label: "Changelog", hint: "What shipped, and when" },
] as const;

/** The top-level items, after Product. */
export const MAIN_LINKS = [
  { key: "pricing", to: "/pricing", label: "Pricing", hint: "$0, $4 or $9 a month" },
  { key: "docs", to: "/docs", label: "Docs", hint: "API and MCP" },
] as const;

type NavKey = "product" | "pricing" | "docs" | "blog";

/** Pages that live under "Product" without a row of their own in its panel. */
const PRODUCT_PATHS = new Set<string>([
  ...PRODUCT_LINKS.map((link) => link.to),
  "/bitly-alternative",
  "/rebrandly-alternative",
  "/dub-alternative",
  "/short-io-alternative",
  "/whatsapp-qr-code",
  "/vcard-qr-code",
  "/wifi-qr-code",
  "/qr-code-monkey-alternative",
  "/tinyurl-alternative",
]);

/** The nav item for the page you are on, or null where none applies (the home page). */
export function currentNavKey(pathname: string): NavKey | null {
  if (pathname === "/pricing") return "pricing";
  if (pathname === "/docs") return "docs";
  if (PRODUCT_PATHS.has(pathname)) return "product";
  return null;
}
