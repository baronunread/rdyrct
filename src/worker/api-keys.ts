import { uid } from "./util";

/** Every issued key starts with this, so a bearer token can be told apart
 * from a BetterAuth cookie value at a glance, and a leaked key is greppable. */
export const API_KEY_PREFIX = "rdyrct_live_";

/** How much of the raw key a listing may show: the prefix plus enough of the
 * secret to tell two keys apart, never enough to reconstruct it. */
const DISPLAY_CHARS = 6;

/** A fresh key: `raw` is returned to the caller exactly once, `prefix` is
 * what gets stored alongside the hash for display. */
export interface GeneratedApiKey {
  raw: string;
  prefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = uid(32);
  const raw = `${API_KEY_PREFIX}${secret}`;
  return { raw, prefix: raw.slice(0, API_KEY_PREFIX.length + DISPLAY_CHARS) };
}

/** SHA-256 hex of a raw key. Only the hash is ever stored, so this is the one
 * direction the value travels. */
export async function hashApiKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
