/**
 * Marketing consent: the one place that reads or writes it.
 *
 * Two lists, each its own consent with its own time and source: product news
 * (`news_opt_in_*`) and offers (`offers_opt_in_*`), plus one
 * `marketing_asked_at` for both (migration 0053). Consent lives in our own
 * D1, never only at a provider, and the default is not opted in: no existing
 * account, and no new one that leaves a box unticked, is ever sent mail for
 * that list. A verified address is not consent (rdyrct-email skill).
 *
 * Three ways in (sign-up form, the one-time dialog, Settings) share one rule:
 * a "settings" answer always applies, while "signup" and "prompt" apply only
 * to an account that has not answered yet. That is what stops a stale answer
 * (a second tab, a leftover sign-up choice after a Google sign-in to an old
 * account) from overwriting a decision the person already made.
 *
 * The unsubscribe link carries an HMAC of the list and the user id, so it
 * needs no login and no cookie. The key is derived from BETTER_AUTH_SECRET under its own
 * label, which gives it a key unrelated to session signing without a second
 * secret to provision on every deploy and self-hosted copy. The cost: rotating
 * BETTER_AUTH_SECRET also breaks the links in mail already sent, so rotate it
 * only when you have to.
 */
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  MARKETING_LISTS,
  type ConsentAnswer,
  type MarketingAnswer,
  type MarketingList,
  type MarketingState,
  type NewsletterAnswers,
} from "@/shared/types";

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

/** A token that names one user and one list, and cannot be made without the
 * secret. No expiry on purpose: an unsubscribe link in an old email must keep
 * working. The signed text is `list:userId`, so a token for one list cannot be
 * turned into one for the other. */
export async function signUnsubscribeToken(
  env: Env,
  userId: string,
  list: MarketingList,
): Promise<string> {
  const payload = encoder.encode(`${list}:${userId}`);
  const mac = await crypto.subtle.sign("HMAC", await derivedKey(env, "sign"), payload);
  return `${toBase64Url(payload)}.${toBase64Url(new Uint8Array(mac))}`;
}

const isList = (text: string): text is MarketingList =>
  MARKETING_LISTS.some((list) => list === text);

/** The user and the list a token names, or null for a tampered or malformed one. */
export async function verifyUnsubscribeToken(
  env: Env,
  token: string | undefined,
): Promise<{ userId: string; list: MarketingList } | null> {
  const [payloadPart, macPart, extra] = (token ?? "").split(".");
  if (!payloadPart || !macPart || extra !== undefined) return null;
  const payload = fromBase64Url(payloadPart);
  const mac = fromBase64Url(macPart);
  if (!payload || !mac) return null;
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify("HMAC", await derivedKey(env, "verify"), mac, payload);
  if (!ok) return null;
  const text = new TextDecoder().decode(payload);
  const split = text.indexOf(":");
  const list = text.slice(0, split);
  const userId = text.slice(split + 1);
  return split > 0 && userId && isList(list) ? { userId, list } : null;
}

export async function unsubscribeUrl(
  env: Env,
  userId: string,
  list: MarketingList,
): Promise<string> {
  const url = new URL(UNSUBSCRIBE_PATH, env.APP_URL);
  url.searchParams.set("t", await signUnsubscribeToken(env, userId, list));
  return url.toString();
}

/** The consent columns a state is read from. */
interface ConsentRow {
  newsOptInAt: Date | null;
  offersOptInAt: Date | null;
  marketingAskedAt: Date | null;
}

export const consentColumns = {
  newsOptInAt: schema.user.newsOptInAt,
  offersOptInAt: schema.user.offersOptInAt,
  marketingAskedAt: schema.user.marketingAskedAt,
};

export function marketingStateOf(row: ConsentRow): MarketingState {
  return {
    news: row.newsOptInAt !== null,
    offers: row.offersOptInAt !== null,
    asked: row.marketingAskedAt !== null,
  };
}

async function marketingState(db: DB, userId: string): Promise<MarketingState> {
  const [row] = await db.select(consentColumns).from(schema.user).where(eq(schema.user.id, userId));
  return row ? marketingStateOf(row) : { news: false, offers: false, asked: false };
}

/**
 * Records an answer and returns the state after it. Each list the answer
 * names gets its own time and source; a list it leaves out is untouched.
 * `applied` is false when the answer was ignored because the account had
 * already answered (see the rule at the top of this file).
 */
export async function setMarketing(
  db: DB,
  userId: string,
  answer: MarketingAnswer,
): Promise<{ state: MarketingState; applied: boolean }> {
  const now = new Date();
  const { source, news, offers } = answer;
  const mayOverwrite =
    source === "settings"
      ? eq(schema.user.id, userId)
      : and(eq(schema.user.id, userId), isNull(schema.user.marketingAskedAt));
  const changed = await db
    .update(schema.user)
    .set({
      ...(news !== undefined && { newsOptInAt: news ? now : null, newsOptInSource: source }),
      ...(offers !== undefined && {
        offersOptInAt: offers ? now : null,
        offersOptInSource: source,
      }),
      marketingAskedAt: sql`coalesce(${schema.user.marketingAskedAt}, ${now.getTime()})`,
    })
    .where(mayOverwrite)
    .returning({ id: schema.user.id });
  return { state: await marketingState(db, userId), applied: changed.length > 0 };
}

/** The unsubscribe link: off one list, or off both ("all"), and counted as
 * answered. Idempotent. */
export async function unsubscribeUser(
  db: DB,
  userId: string,
  from: MarketingList | "all",
): Promise<boolean> {
  const changed = await db
    .update(schema.user)
    .set({
      ...(from !== "offers" && { newsOptInAt: null }),
      ...(from !== "news" && { offersOptInAt: null }),
      marketingAskedAt: sql`coalesce(${schema.user.marketingAskedAt}, ${Date.now()})`,
    })
    .where(eq(schema.user.id, userId))
    .returning({ id: schema.user.id });
  return changed.length > 0;
}

/** One list's columns. */
const LIST_COLUMNS = {
  news: { at: schema.user.newsOptInAt, source: schema.user.newsOptInSource },
  offers: { at: schema.user.offersOptInAt, source: schema.user.offersOptInSource },
} satisfies Record<MarketingList, { at: SQLiteColumn; source: SQLiteColumn }>;

/** Who a send to `list` reaches: opted in to it, address verified, not banned. */
const reachable = (list: MarketingList) =>
  and(
    isNotNull(LIST_COLUMNS[list].at),
    eq(schema.user.emailVerified, true),
    eq(schema.user.banned, false),
  );

/** An account's answer about one list as one word, for the admin users list. */
export function consentAnswerOf(at: Date | null, asked: Date | null): ConsentAnswer {
  if (at) return "on";
  return asked ? "off" : "unasked";
}

/** How every account has answered one list: one grouped read over the user table. */
async function listAnswers(db: DB, list: MarketingList): Promise<NewsletterAnswers> {
  const { at, source } = LIST_COLUMNS[list];
  const rows = await db
    .select({
      source,
      optedIn: sql<number>`${at} is not null`,
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

/** Both lists' answers. */
export async function newsletterAnswers(db: DB): Promise<Record<MarketingList, NewsletterAnswers>> {
  const [news, offers] = await Promise.all([listAnswers(db, "news"), listAnswers(db, "offers")]);
  return { news, offers };
}

export async function countOptedIn(db: DB, list: MarketingList): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.user)
    .where(reachable(list));
  return row?.n ?? 0;
}

/** The next page of people a send to `list` reaches, by id after `after`.
 * Read fresh for every batch, so somebody who unsubscribes while a send is
 * running is left out of the batches still to go. */
export async function optedInRecipients(
  db: DB,
  list: MarketingList,
  limit: number,
  after = "",
): Promise<{ id: string; email: string }[]> {
  return db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(and(reachable(list), gt(schema.user.id, after)))
    .orderBy(asc(schema.user.id))
    .limit(limit);
}
