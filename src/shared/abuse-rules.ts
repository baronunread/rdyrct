/**
 * Cheap, deterministic signals that a destination is probably a scam.
 *
 * A hold, never a block: a legitimate developer can ship "paypal-checkout-demo
 * .vercel.app", so a match only puts the link on hold for a human to look at,
 * and restoring it is one click. Pure so it runs the same in the Worker and in
 * a unit test.
 */

/** Hosts anyone can deploy to for free. A real brand does not live on these,
 * and a scam kit that impersonates one almost always does. */
const FREE_HOST_SUFFIXES = [
  "up.railway.app",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "herokuapp.com",
  "onrender.com",
  "fly.dev",
  "github.io",
  "glitch.me",
  "web.app",
  "firebaseapp.com",
  "ngrok-free.app",
  "ngrok.io",
  "replit.app",
  "repl.co",
  "framer.website",
  "wixsite.com",
  "weebly.com",
  "blogspot.com",
];

/** Names scams borrow: payments, banks, shopping, delivery, government, big
 * platforms. Matched as a substring of the hostname, so "phonepewheel" hits
 * "phonepe". Short or common words are left out: they would hold real links. */
const BRAND_WORDS = [
  "phonepe",
  "paytm",
  "gpay",
  "flipkart",
  "paypal",
  "amazon",
  "netflix",
  "microsoft",
  "apple-id",
  "appleid",
  "icloud",
  "google-",
  "gmail-",
  "facebook",
  "instagram",
  "whatsapp",
  "binance",
  "coinbase",
  "metamask",
  "blockchain-",
  "wellsfargo",
  "bankofamerica",
  "chase-",
  "hdfc",
  "icici",
  "sbi-",
  "fedex",
  "dhl-",
  "usps",
  "royalmail",
  "irs-",
  "hmrc",
  "docusign",
  "dropbox",
  "steam-",
  "roblox",
];

/** The reason to hold a link on this destination, or null to leave it alone. */
export function holdReasonFor(destination: string): string | null {
  let host: string;
  try {
    host = new URL(destination).hostname.toLowerCase();
  } catch {
    return null;
  }
  const freeHost = FREE_HOST_SUFFIXES.find((s) => host === s || host.endsWith(`.${s}`));
  if (!freeHost) return null;
  const brand = BRAND_WORDS.find((w) => host.includes(w));
  if (!brand) return null;
  return `Held for review: "${brand}" in the name of a free ${freeHost} site.`;
}

/** The host a blocklist entry is matched on. Lower case, no port, no "www.". */
export function blockHostOf(destination: string): string | null {
  try {
    return new URL(destination).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
