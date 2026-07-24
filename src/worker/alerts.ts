import type { Env } from "./env";

/**
 * Best-effort alert to Better Stack over its HTTP log source. Never throws: a
 * monitoring hiccup must never block acking a queue message or anything else
 * on the call site's path. No-ops when unconfigured, so local dev and tests
 * need nothing set.
 */
export async function alertBetterStack(
  env: Env,
  events: Array<Record<string, unknown>>,
): Promise<void> {
  if (!env.BETTERSTACK_SOURCE_TOKEN || !env.BETTERSTACK_INGEST_URL) return;
  try {
    const res = await fetch(env.BETTERSTACK_INGEST_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.BETTERSTACK_SOURCE_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(events),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) console.error(`Better Stack alert failed: ${res.status}`);
  } catch (error) {
    console.error("Better Stack alert failed", error);
  }
}
