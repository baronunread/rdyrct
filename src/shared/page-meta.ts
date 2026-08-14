/**
 * What each public page calls itself in a search result and a link preview.
 *
 * Shared because two places need the same strings and must not drift: the
 * Worker writes them into the HTML it serves (src/worker/page-meta.ts), and
 * the SPA re-applies them on client-side navigation, where no new document is
 * fetched and the head would otherwise still describe the page somebody
 * arrived on.
 *
 * The wording leads with what people type. "URL shortener" and "QR code
 * generator" are the searches; the brand is not, and a title that opens with
 * it spends the most valuable words in the result on a name nobody is looking
 * for yet.
 */
export interface PageMeta {
  title: string;
  description: string;
}

/**
 * What index.html ships, and therefore what every page that has no entry of
 * its own should read. Kept here rather than left implicit in the HTML: the
 * client hook has to put this back when it leaves a public page, and
 * "restore whatever the document arrived with" is wrong for exactly the
 * visitor who arrived on the public page itself.
 */
export const DEFAULT_PAGE_META: PageMeta = {
  title: "rdyrct - branded short links for your team",
  description: "Branded short links, QR codes, and custom domains with privacy-friendly analytics.",
};

export const PUBLIC_PAGE_META: Record<string, PageMeta> = {
  "/": {
    title: "rdyrct - URL shortener and QR code generator with click analytics",
    description:
      "Free URL shortener and QR code generator for teams. Branded short links on your own domain, custom QR codes with your logo, and privacy-friendly click analytics with UTM tracking.",
  },
  "/qr-code-generator": {
    title: "Free QR code generator with logo - PNG and SVG, no account",
    description:
      "Make a custom QR code online for free: your logo in the middle, your colors, rounded dots, and a PNG or SVG download. No sign-up, no watermark, and the code is generated in your browser.",
  },
  "/signup": {
    title: "Sign up - rdyrct URL shortener and QR codes",
    description:
      "Create a free rdyrct account: short links with click analytics, QR codes, and UTM tracking for your team. No card required.",
  },
  "/login": {
    title: "Log in - rdyrct",
    description: "Log in to your rdyrct account to manage short links, QR codes and analytics.",
  },
  "/privacy": {
    title: "Privacy policy - rdyrct",
    description:
      "What rdyrct stores and what it does not: click analytics keep country, referrer, device and time, never an IP address or a precise location.",
  },
  "/terms": {
    title: "Terms of service - rdyrct",
    description: "The terms covering rdyrct short links, QR codes and analytics.",
  },
};
