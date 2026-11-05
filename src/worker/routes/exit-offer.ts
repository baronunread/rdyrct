/**
 * The leaving popup's one request: "email me the code" (POST
 * /api/exit-offer). rdyrct.com only: index.ts mounts it only on that build,
 * and it 404s there too while EXIT_OFFER_CODE is unset.
 *
 * Unauthenticated, so it carries the public forms' defences: Turnstile on its
 * own scope and a per-caller rate limit. On top, one email per address per
 * 30 days, remembered in KV under a keyed digest of the address (never the
 * address) that expires on its own.
 *
 * The answer is the same whether the email went out or the address asked
 * recently, and the mail goes out after the response, so neither the body
 * nor the timing says which.
 */
import { Hono } from "hono";
import * as v from "valibot";
import { HTTPException } from "hono/http-exception";
import { TURNSTILE_FAILED_CODE, type JsonValue } from "@/shared/types";
import { RDYRCT_SITE } from "@/shared/site";
import type { AppEnv, Env } from "../env";
import { jsonBodyLimit } from "../body-limit";
import { spendToken } from "../turnstile";
import { optionalText, parseBody } from "../schemas";
import { publicClientKey, rateLimitAllows, recipientDigest } from "../rate-limit";
import { renderEmail } from "../email-layout";
import { sendEmail } from "../email";
import { logFailure } from "../log-failure";

/** One email per address in this many days. */
const REPEAT_SECONDS = 30 * 24 * 60 * 60;

/** The code customers type at checkout, or null when this deployment makes
 * no offer: a self-hosted build, or EXIT_OFFER_CODE unset. */
export function exitOfferCode(env: Env): string | null {
  return (RDYRCT_SITE && env.EXIT_OFFER_CODE?.trim()) || null;
}

const exitOfferBodySchema = v.object({
  email: v.pipe(
    v.string("Enter your email"),
    v.trim(),
    v.nonEmpty("Enter your email"),
    v.maxLength(254, "That address is too long"),
    v.email("Enter a valid email address"),
  ),
  turnstileToken: optionalText,
});

/** The code email. Asked for by the visitor, so it is transactional: no
 * marketing consent, no unsubscribe link, the ordinary sender. It goes out
 * after the response, so a failure is logged, never thrown. */
async function sendCodeEmail(env: Env, to: string, code: string): Promise<void> {
  const heading = "Your 20% off rdyrct";
  const content = {
    preheader: "20% off your first 3 months of Hobby or Pro.",
    heading,
    paragraphs: ["Use this code at checkout for 20% off your first 3 months of Hobby or Pro."],
    code,
    cta: { label: "See plans", url: `${env.APP_URL}/pricing` },
    note: "Works on a new Hobby or Pro subscription.",
  };
  try {
    await sendEmail(env, to, heading, renderEmail(content, env.APP_URL, to));
  } catch (error) {
    logFailure("exit_offer_email_failed", error);
  }
}

export const exitOfferRoutes = new Hono<AppEnv>();
exitOfferRoutes.use("*", jsonBodyLimit());

exitOfferRoutes.post("/", async (c) => {
  const log = c.get("log");
  log.set({ route: "/api/exit-offer" });
  const code = exitOfferCode(c.env);
  if (!code) throw new HTTPException(404, { message: "Not found" });

  const caller = await publicClientKey(c.req.raw, c.env.BETTER_AUTH_SECRET);
  if (
    !(await rateLimitAllows(c.env.RL_ANON_LINK, `exit-offer:${caller}`, {
      group: "anon_link",
      method: "POST",
    }))
  )
    throw new HTTPException(429, { message: "Too many requests from here. Try again shortly." });

  const body = parseBody(exitOfferBodySchema, await c.req.json<JsonValue>().catch(() => ({})));
  if (!(await spendToken(c.env, "exit-offer", body.turnstileToken)))
    throw new HTTPException(400, {
      message: "Could not verify you are human. Reload the page and try again.",
      cause: { code: TURNSTILE_FAILED_CODE },
    });

  const key = `exit-offer:${await recipientDigest(c.env.BETTER_AUTH_SECRET, body.email)}`;
  const repeat = (await c.env.LINKS.get(key)) !== null;
  log.set({ exitOffer: { outcome: repeat ? "repeat" : "sent" } });
  if (!repeat) {
    c.executionCtx.waitUntil(
      Promise.all([
        c.env.LINKS.put(key, "1", { expirationTtl: REPEAT_SECONDS }),
        sendCodeEmail(c.env, body.email, code),
      ]),
    );
  }
  return c.json({ sent: true });
});
