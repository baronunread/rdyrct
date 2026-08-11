/**
 * Cap: proof-of-work challenges, issued and verified by this Worker (#98).
 *
 * A rate limit is a ceiling; this is a price. It catches the distributed,
 * low-and-slow bot that stays politely under every limit, by making each
 * attempt cost real CPU in the caller's browser.
 *
 * `capjs-core` is stateless, so there is no Cap server to run: challenges
 * are signed with CAP_SECRET and verified against that signature. The only
 * state we keep is the single-use nonce, in the KV namespace we already
 * have.
 *
 * Instrumentation is deliberately off. That mode fingerprints the browser to
 * spot automation, which is the exact thing we rejected Turnstile for, and it
 * pulls esbuild and javascript-obfuscator in at runtime to build the probe
 * script. Proof-of-work needs neither.
 */
import { generateChallenge, validateChallenge } from "capjs-core";
import type { Env } from "./env";
import { keyedDigest } from "./rate-limit";

/** Namespaces the challenge so a token minted for signup cannot be spent on
 * password reset. Cap binds this into the signature. */
export type CapScope = "signup" | "password-reset" | "anon-link";

/** How long a solved token stays spendable. Long enough to finish typing a
 * form, short enough that a harvested one is worthless. */
const TOKEN_TTL_MS = 10 * 60 * 1000;
/** How long an unsolved challenge stays valid. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * Work the client must do. Cap's defaults (50 challenges of difficulty 4)
 * take multiple seconds on a phone, which is a tax on the honest visitor
 * for no extra deterrence. These land around 200-400ms on a laptop while
 * still making bulk automation pay per attempt.
 */
const CHALLENGE_COUNT = 12;
const CHALLENGE_SIZE = 24;
const CHALLENGE_DIFFICULTY = 3;

/** Off unless CAP_SECRET is set, matching BETTERSTACK_INGEST_URL and friends:
 * local dev, CI and e2e stay quiet rather than breaking signup. */
export function capEnabled(env: Env): boolean {
  return !!env.CAP_SECRET;
}

export async function issueChallenge(env: Env, scope: CapScope) {
  return generateChallenge(env.CAP_SECRET!, {
    challengeCount: CHALLENGE_COUNT,
    challengeSize: CHALLENGE_SIZE,
    challengeDifficulty: CHALLENGE_DIFFICULTY,
    expiresMs: CHALLENGE_TTL_MS,
    scope,
  });
}

/**
 * Marks a challenge signature spent, and reports whether it was already.
 *
 * KV is eventually consistent, so a token presented to two colocations at
 * once can pass twice: the write has not propagated yet. That is a real
 * ceiling and it is an acceptable one for a captcha, whose job is to price
 * bulk attempts rather than to guarantee exactly-once. Making it airtight
 * would mean a Durable Object per nonce, which costs more than the replay
 * is worth.
 */
async function consumeNonce(env: Env, signatureHex: string, ttlMs: number): Promise<boolean> {
  const key = `cap:${signatureHex}`;
  if (await env.LINKS.get(key)) return false;
  // KV's floor is 60s; a shorter TTL is rejected outright.
  await env.LINKS.put(key, "1", { expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)) });
  return true;
}

export async function verifySolution(
  env: Env,
  scope: CapScope,
  body: { token: string; solutions: unknown },
) {
  return validateChallenge(
    env.CAP_SECRET!,
    { token: body.token, solutions: body.solutions as number[] },
    {
      scope,
      tokenTtlMs: TOKEN_TTL_MS,
      consumeNonce: (signatureHex, ttlMs) => consumeNonce(env, signatureHex, ttlMs),
      // Signed, not stored. Cap's default token is a random string the server
      // has to remember, and remembering it here meant a KV write at /redeem
      // read back by the form submit a second later. KV is eventually
      // consistent: that read missed often enough that signup failed for
      // real people, and re-solving lost the same race (#98).
      signToken: ({ expires }) => signToken(env, scope, expires),
    },
  );
}

/** Compares two same-length strings without leaking where they differ. */
function equalsConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `expires.signature`, signed with CAP_SECRET so any colocation can check it
 * without shared state. */
async function signToken(env: Env, scope: CapScope, expires: number): Promise<string> {
  return `${expires}.${await keyedDigest(env.CAP_SECRET!, `cap:${scope}:${expires}`)}`;
}

/**
 * Checks the token a form submitted, and burns it.
 *
 * The signature is the whole check, so a valid token is accepted whatever KV
 * knows. KV only records that a token was spent, to turn away a replay: a
 * lookup that misses because the write has not propagated lets one extra
 * submit through within the ten-minute window, which is the direction this
 * should fail in.
 */
export async function spendToken(env: Env, scope: CapScope, token: string): Promise<boolean> {
  if (!capEnabled(env)) return true;
  const [expires] = token.split(".");
  const expiresAt = Number(expires);
  if (!expiresAt || expiresAt < Date.now()) return false;
  if (!equalsConstantTime(token, await signToken(env, scope, expiresAt))) return false;

  const key = `cap:spent:${scope}:${token}`;
  if (await env.LINKS.get(key)) return false;
  await env.LINKS.put(key, "1", {
    expirationTtl: Math.max(60, Math.ceil((expiresAt - Date.now()) / 1000)),
  });
  return true;
}
