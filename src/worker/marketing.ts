/**
 * Two lists, each its own consent, time and source (migration 0053). A verified address is
 * not consent. "onboarding" and "prompt" answers apply only to an account that has not
 * answered, so a stale one cannot overwrite a decision. Rotating BETTER_AUTH_SECRET breaks mailed unsubscribe links.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  ACTIVE_WITHIN_DAYS,
  EVERYONE,
  MARKETING_LISTS,
  type AudienceFilter,
  type AudiencePlan,
  type AudienceStage,
  type ConsentAnswer,
  type MarketingAnswer,
  type MarketingList,
  type MarketingState,
  type NewsletterAnswers,
} from "@/shared/types";

const TOKEN_LABEL = "rdyrct:newsletter-unsubscribe:v1";

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

async function derivedKey(env: Env, usage: "sign" | "verify"): Promise<CryptoKey> {
  const root = await hmacKey(encoder.encode(env.BETTER_AUTH_SECRET), "sign");
  const derived = await crypto.subtle.sign("HMAC", root, encoder.encode(TOKEN_LABEL));
  return hmacKey(new Uint8Array(derived), usage);
}

/** No expiry: a link in an old email must keep working. `list:userId` is signed, so a token cannot switch lists. */
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

export async function marketingState(db: DB, userId: string): Promise<MarketingState> {
  const [row] = await db.select(consentColumns).from(schema.user).where(eq(schema.user.id, userId));
  return row ? marketingStateOf(row) : { news: false, offers: false, asked: false };
}

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

/** A repeat writes nothing: the link is public and anyone holding it can send it again. */
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
    .where(
      and(
        eq(schema.user.id, userId),
        or(
          isNull(schema.user.marketingAskedAt),
          from === "offers" ? undefined : isNotNull(schema.user.newsOptInAt),
          from === "news" ? undefined : isNotNull(schema.user.offersOptInAt),
        ),
      ),
    )
    .returning({ id: schema.user.id });
  return changed.length > 0;
}

const LIST_COLUMNS = {
  news: { at: schema.user.newsOptInAt, source: schema.user.newsOptInSource },
  offers: { at: schema.user.offersOptInAt, source: schema.user.offersOptInSource },
} satisfies Record<MarketingList, { at: SQLiteColumn; source: SQLiteColumn }>;

const DAY_MS = 24 * 60 * 60 * 1000;

// Literal "user".id: interpolated columns render unqualified inside a
// correlated subquery and bind to the subquery's own table.
const madeALink = sql`exists (select 1 from links where links.created_by = "user".id)`;

/** Newest session, or user.last_seen_at, which outlives the sessions a sign-out deletes. */
const lastSeen = sql`(
  select max(t) from (
    select session.updated_at as t from session where session.user_id = "user".id
    union all
    select "user".last_seen_at
  )
)`;

/**
 * Decided from D1 alone, never from product analytics (which only see people
 * who accepted them). `now` is a parameter so every batch of one request draws
 * the same line.
 */
function stageWhere(stage: AudienceStage, now: number): SQL | undefined {
  const cutoff = now - ACTIVE_WITHIN_DAYS * DAY_MS;
  switch (stage) {
    case "any":
      return undefined;
    case "new":
      return sql`not ${madeALink}`;
    case "active":
      return sql`${madeALink} and ${lastSeen} >= ${cutoff}`;
    case "slipping":
      return sql`${madeALink} and coalesce(${lastSeen}, 0) < ${cutoff}`;
  }
}

const PAID_PLANS = ["hobby", "pro"] as const;

function planWhere(plan: AudiencePlan): SQL | undefined {
  if (plan === "any") return undefined;
  return plan === "free" ? eq(schema.user.plan, "free") : inArray(schema.user.plan, PAID_PLANS);
}

function audienceWhere(filter: AudienceFilter, now: number): SQL | undefined {
  return and(stageWhere(filter.stage, now), planWhere(filter.plan));
}

export function sameAudience(a: AudienceFilter, b: AudienceFilter): boolean {
  return a.stage === b.stage && a.plan === b.plan;
}

const reachable = (list: MarketingList, filter: AudienceFilter, now = Date.now()) =>
  and(
    isNotNull(LIST_COLUMNS[list].at),
    eq(schema.user.emailVerified, true),
    eq(schema.user.banned, false),
    audienceWhere(filter, now),
  );

export function consentAnswerOf(at: Date | null, asked: Date | null): ConsentAnswer {
  if (at) return "on";
  return asked ? "off" : "unasked";
}

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
    yes: { onboarding: 0, prompt: 0, settings: 0 },
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

export async function newsletterAnswers(db: DB): Promise<Record<MarketingList, NewsletterAnswers>> {
  const [news, offers] = await Promise.all([listAnswers(db, "news"), listAnswers(db, "offers")]);
  return { news, offers };
}

export async function countOptedIn(
  db: DB,
  list: MarketingList,
  filter: AudienceFilter = EVERYONE,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.user)
    .where(reachable(list, filter));
  return row?.n ?? 0;
}

export async function optedInRecipients(
  db: DB,
  list: MarketingList,
  limit: number,
  { after = "", filter = EVERYONE, now }: { after?: string; filter?: AudienceFilter; now?: number },
): Promise<{ id: string; email: string }[]> {
  return db
    .select({ id: schema.user.id, email: schema.user.email })
    .from(schema.user)
    .where(and(reachable(list, filter, now), gt(schema.user.id, after)))
    .orderBy(asc(schema.user.id))
    .limit(limit);
}

export async function stillReachable(
  db: DB,
  list: MarketingList,
  ids: string[],
  { filter = EVERYONE, now }: { filter?: AudienceFilter; now?: number },
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    // One bound JSON array: D1 takes at most 100 parameters a query.
    .where(
      and(
        reachable(list, filter, now),
        sql`${schema.user.id} in (select value from json_each(${JSON.stringify(ids)}))`,
      ),
    );
  return new Set(rows.map((row) => row.id));
}
