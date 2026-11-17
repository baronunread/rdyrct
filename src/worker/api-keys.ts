import { uid } from "./util";

export const API_KEY_PREFIX = "rdyrct_live_";

const DISPLAY_CHARS = 6;

export interface GeneratedApiKey {
  raw: string;
  prefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = uid(32);
  const raw = `${API_KEY_PREFIX}${secret}`;
  return { raw, prefix: raw.slice(0, API_KEY_PREFIX.length + DISPLAY_CHARS) };
}

// Only the hash is ever stored.
export async function hashApiKey(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
