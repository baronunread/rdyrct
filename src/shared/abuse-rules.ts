/**
 * A match only holds a link for review, never blocks: a legitimate developer can ship
 * "paypal-checkout-demo.vercel.app". Pure so the Worker and unit tests agree.
 */

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

/** Matched as a substring of the hostname. Short or common words are left out: they would hold real links. */
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

function freeHostOf(host: string): string | null {
  return FREE_HOST_SUFFIXES.find((s) => host === s || host.endsWith(`.${s}`)) ?? null;
}

/** On its own this means nothing; it is the second signal that turns heavy traffic into a pause. */
export function isFreeHost(destination: string): boolean {
  const host = hostOf(destination);
  return host !== null && freeHostOf(host) !== null;
}

export function holdReasonFor(destination: string): string | null {
  const host = hostOf(destination);
  if (!host) return null;
  const freeHost = freeHostOf(host);
  if (!freeHost) return null;
  const brand = BRAND_WORDS.find((w) => host.includes(w));
  if (!brand) return null;
  return `Held for review: "${brand}" in the name of a free ${freeHost} site.`;
}

/** Never blocked, nor any host under them: an abuser who also linked to one would take it from every
customer. A free app host's own name is here, while one app on it ("x.up.railway.app") is not. */
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

export function blockable(host: string): boolean {
  // One app on a free host is its maker's own site.
  if (FREE_HOST_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`))) return true;
  return !NEVER_BLOCKED.some((site) => host === site || host.endsWith(`.${site}`));
}

/** A host and each parent domain under its top level. notscam.example.com never matches scam.example.com. */
export function hostAndParents(host: string): string[] {
  const labels = host.split(".");
  return labels.slice(0, -1).map((_, i) => labels.slice(i).join("."));
}

export function blockHostOf(destination: string): string | null {
  try {
    // A trailing dot is the same host to DNS, so it must not slip past a block.
    return (
      new URL(destination).hostname
        .toLowerCase()
        .replace(/\.+$/, "")
        .replace(/^www\./, "") || null
    );
  } catch {
    return null;
  }
}
