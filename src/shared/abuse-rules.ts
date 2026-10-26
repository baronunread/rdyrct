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

function hostOf(destination: string): string | null {
  try {
    return new URL(destination).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The free app host a destination sits on, or null. */
function freeHostOf(host: string): string | null {
  return FREE_HOST_SUFFIXES.find((s) => host === s || host.endsWith(`.${s}`)) ?? null;
}

/** Whether a destination is on a host anyone can deploy to for free. On its
 * own that means nothing; it is the second signal that turns heavy traffic
 * from "worth a look" into "worth a pause". */
export function isFreeHost(destination: string): boolean {
  const host = hostOf(destination);
  return host !== null && freeHostOf(host) !== null;
}

/** The reason to hold a link on this destination, or null to leave it alone. */
export function holdReasonFor(destination: string): string | null {
  const host = hostOf(destination);
  if (!host) return null;
  const freeHost = freeHostOf(host);
  if (!freeHost) return null;
  const brand = BRAND_WORDS.find((w) => host.includes(w));
  if (!brand) return null;
  return `Held for review: "${brand}" in the name of a free ${freeHost} site.`;
}

/** The host a blocklist entry is matched on. Lower case, no port, no "www.". */
/** Sites a ban can never block, nor any host under them: an abuser who also
 * linked to one would otherwise take it away from every customer. A free app
 * host's own name is here, while one app on it ("x.up.railway.app") is not. */
const NEVER_BLOCKED = [
  "google.com",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "instagram.com",
  "whatsapp.com",
  "wa.me",
  "x.com",
  "twitter.com",
  "t.me",
  "telegram.org",
  "linkedin.com",
  "tiktok.com",
  "reddit.com",
  "github.com",
  "apple.com",
  "microsoft.com",
  "amazon.com",
  "wikipedia.org",
  "bit.ly",
  ...FREE_HOST_SUFFIXES,
];

/** Whether a ban may put this host on the blocklist. */
export function blockable(host: string): boolean {
  // One app on a free host is its maker's own site.
  if (FREE_HOST_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`))) return true;
  return !NEVER_BLOCKED.some((site) => host === site || host.endsWith(`.${site}`));
}

export function blockHostOf(destination: string): string | null {
  try {
    return new URL(destination).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
