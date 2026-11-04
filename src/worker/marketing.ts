/**
 * Marketing consent: the one place that reads or writes it.
 *
 * Consent lives in our own D1 (`user.marketing_*`, migration 0053), never only
 * at a provider, and the default is not opted in: no existing account, and no
 * new one that leaves the box unticked, is ever sent a newsletter. A verified
 * address is not consent (rdyrct-email skill).
 *
 * Three ways in (sign-up form, the one-time dialog, Settings) share one rule:
 * a "settings" answer always applies, while "signup" and "prompt" apply only
 * to an account that has not answered yet. That is what stops a stale answer
 * (a second tab, a leftover sign-up choice after a Google sign-in to an old
 * account) from overwriting a decision the person already made.
 *
 * The unsubscribe link carries an HMAC of the user id, so it needs no login
 * and no cookie. The key is derived from BETTER_AUTH_SECRET under its own
 * label, which gives it a key unrelated to session signing without a second
 * secret to provision on every deploy and self-hosted copy. The cost: rotating
 * BETTER_AUTH_SECRET also breaks the links in mail already sent, so rotate it
 * only when you have to.
 */
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import type { MarketingSource, MarketingState, NewsletterAnswers } from "@/shared/types";

const TOKEN_LABEL = "rdyrct:newsletter-unsubscribe:v1";

/** Where the public unsubscribe page lives, on APP_URL. */
export const UNSUBSCRIBE_PATH = "/unsubscribe";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: Uint8Array, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** The signing key: HMAC(BETTER_AUTH_SECRET, label), so it is not the secret. */
async function derivedKey(env: Env, usage: "sign" | "verify"): Promise<CryptoKey> {
  const root = await hmacKey(encoder.encode(env.BETTER_AUTH_SECRET), "sign");
  const derived = await crypto.subtle.sign("HMAC", root, encoder.encode(TOKEN_LABEL));
  return hmacKey(new Uint8Array(derived), usage);
}

/** A token that names one user and cannot be made without the secret. No
 * expiry on purpose: an unsubscribe link in an old email must keep working. */
export async function signUnsubscribeToken(env: Env, userId: string): Promise<string> {
  const id = encoder.encode(userId);
  const mac = await crypto.subtle.sign("HMAC", await derivedKey(env, "sign"), id);
  return `${toBase64Url(id)}.${toBase64Url(new Uint8Array(mac))}`;
}

/** The user id a token names, or null for a tampered or malformed one. */
export async function verifyUnsubscribeToken(
  env: Env,
  token: string | undefined,
): Promise<string | null> {
  const [idPart, macPart, extra] = (token ?? "").split(".");
  if (!idPart || !macPart || extra !== undefined) return null;
  const id = fromBase64Url(idPart);
  const mac = fromBase64Url(macPart);
  if (!id || !mac) return null;
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify("HMAC", await derivedKey(env, "verify"), mac, id);
  return ok ? new TextDecoder().decode(id) : null;
}

export async function unsubscribeUrl(env: Env, userId: string): Promise<string> {
  const url = new URL(UNSUBSCRIBE_PATH, env.APP_URL);
  url.searchParams.set("t", await signUnsubscribeToken(env, userId));
  return url.toString();
}

export function marketingStateOf(row: {
  marketingOptInAt: Date | null;
  marketingAskedAt: Date | null;
}): MarketingState {
  return { optedIn: row.marketingOptInAt !== null, asked: row.marketingAskedAt !== null };
}

async function marketingState(db: DB, userId: string): Promise<MarketingState> {
  const [row] = await db
    .select({
      marketingOptInAt: schema.user.marketingOptInAt,
      marketingAskedAt: schema.user.marketingAskedAt,
    })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return row ? marketingStateOf(row) : { optedIn: false, asked: false };
}

/**
 * Records an answer and returns the state after it. `applied` is false when
 * the answer was ignored because the account had already answered (see the
 * rule at the top of this file).
 */
export async function setMarketing(
  db: DB,
  userId: string,
  optIn: boolean,
  source: MarketingSource,
): Promise<{ state: MarketingState; applied: boolean }> {
  const now = new Date();
  const mayOverwrite =
    source === "settings"
      ? eq(schema.user.id, userId)
      : and(eq(schema.user.id, userId), isNull(schema.user.marketingAskedAt));
  const changed = await db
    .update(schema.user)
    .set({
      marketingOptInAt: optIn ? now : null,
      marketingOptInSource: source,
      marketingAskedAt: sql`coalesce(${schema.user.marketingAskedAt}, ${now.getTime()})`,
    })
    .where(mayOverwrite)
    .returning({ id: schema.user.id });
  return { state: await marketingState(db, userId), applied: changed.length > 0 };
}

/** The unsubscribe link: opted out, and counted as answered. Idempotent. */
export async function unsubscribeUser(db: DB, userId: string): Promise<boolean> {
  const changed = await db
    .update(schema.user)
    .set({
      marketingOptInAt: null,
      marketingAskedAt: sql`coalesce(${schema.user.marketingAskedAt}, ${Date.now()})`,
    })
    .where(eq(schema.user.id, userId))
    .returning({ id: schema.user.id });
  return changed.length > 0;
}

/** Who a newsletter reaches: opted in, address verified, not banned. */
const reachable = and(
  isNotNull(schema.user.marketingOptInAt),
  eq(schema.user.emailVerified, true),
  eq(schema.user.banned, false),
);

/** An account's answer as one word, for the admin users list. */
export function newsStateOf(row: {
  marketingOptInAt: Date | null;
  marketingAskedAt: Date | null;
}): "on" | "off" | "unasked" {
  if (row.marketingOptInAt) return "on";
  return row.marketingAskedAt ? "off" : "unasked";
}

/** How every account has answered: one grouped read over the user table. */
export async function newsletterAnswers(db: DB): Promise<NewsletterAnswers> {
  const rows = await db
    .select({
      source: schema.user.marketingOptInSource,
      optedIn: sql<number>`${schema.user.marketingOptInAt} is not null`,
      asked: sql<number>`${schema.user.marketingAskedAt} is not null`,
      n: sql<number>`count(*)`,
    })
    .from(schema.user)
    .groupBy(sql`1, 2, 3`);
  const answers: NewsletterAnswers = {
    yes: { signup: 0, prompt: 0, settings: 0 },
    no: 0,
    unasked: 0,
  };
  for (const row of rows) {
    // An opt-in always records its source (setMarketing writes both).
    if (row.optedIn && row.source) answers.yes[row.source] += row.n;
    else if (row.asked) answers.no += row.n;
    else answers.unasked += row.n;
  }
  return answers;
}

export async function countOptedIn(db: DB): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.user)
    .where(reachable);
  return row?.n ?? 0;
}

/** The next page of people a send reaches, by id after `after`. Read fresh
 * for every batch, so somebody who unsubscribes while a send is running is
 * left out of the batches still to go. */
export async function optedInRecipients(
  db: DB,
  limit: number,
  after = "",
): Promise<{ id: string; email: string }[]> {
  return db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(and(reachable, gt(schema.user.id, after)))
    .orderBy(asc(schema.user.id))
    .limit(limit);
}
