import { betterAuth } from "better-auth";
import type { JsonValue } from "../shared/types";
import { optionalText } from "./schemas";
import * as v from "valibot";
import { lookup } from "../shared/lookup";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, ne } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { alertBetterStack } from "./alerts";
import { afterResponse } from "./background";
import { sendEmail } from "./email";
import { renderEmail } from "./email-layout";
import { hashPassword, verifyPassword } from "./password";
import { uid } from "./util";
import { spendToken, type CapScope } from "./cap";
import { createOwnedOrg } from "./plan";
import { deleteOrg } from "./routes/orgs";
import { defaultOrgName } from "@/shared/org-name";
import { CAP_FAILED_CODE, CAP_TOKEN_HEADER } from "@/shared/types";

/** better-auth paths that must carry a solved Cap token, and the scope the
 * token has to have been minted for. Keyed by `ctx.path`, which is relative
 * to /api/auth. */
const CAP_GUARDED_PATHS = {
  "/sign-up/email": "signup",
  "/request-password-reset": "password-reset",
} satisfies Record<string, CapScope>;

/**
 * Gives an account an organization if it has none.
 *
 * Every account owns one from the moment it can sign in, so "no organization"
 * is a state somebody chose (they deleted their last one) rather than the
 * state everybody starts in. The empty-state screen used to make the
 * organization while telling the person it already existed; now it is true
 * when they read it, and Settings can rename it the same second.
 *
 * On session creation rather than user creation: a signup that never gets
 * past the six-digit code leaves nothing behind, so admin usage counts stay
 * about real accounts. The cost is one indexed read per sign-in.
 *
 * Failure is swallowed on purpose. Nobody should be locked out of an account
 * because an organization could not be written, and the client still carries
 * the create-organization form for exactly that case.
 */
async function ensureOrganization(env: Env, db: DB, userId: string): Promise<void> {
  try {
    const owned = await db
      .select({ orgId: schema.orgMembers.orgId })
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.userId, userId), eq(schema.orgMembers.role, "owner")))
      .limit(1);
    if (owned.length > 0) return;

    const rows = await db
      .select({ email: schema.user.email, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    const account = rows[0];
    if (!account) return;

    await createOwnedOrg(db, env, {
      orgId: uid(),
      userId,
      name: defaultOrgName(account.email, account.name ?? undefined),
      ts: Date.now(),
      // One, not the plan's allowance. createOwnedOrg writes the membership
      // only while the owner is under the limit it is given, in a single
      // statement, so a limit of one is what makes this "give them an
      // organization if they have none" rather than "if they have room".
      // The read above is a fast path, not the guard: two sessions created
      // at once both see nothing, and on Pro, where the allowance is three,
      // both would otherwise have room and the account would arrive with two
      // organizations and no way to tell which is theirs.
      ownedOrgLimit: 1,
    });
  } catch (error) {
    console.warn("default_org_failed", String(error));
  }
}

/**
 * Organizations this account owns, split by whether anyone else is in them.
 *
 * Account deletion tears down what only they hold and refuses when other
 * people are still members: a solo organization is part of the account, but
 * one with teammates in it is not the deleter's alone to destroy.
 */
async function ownedOrgsForDeletion(db: DB, userId: string) {
  const owned = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.userId, userId), eq(schema.orgMembers.role, "owner")));
  if (owned.length === 0) return { solo: [], shared: [] };

  const ids = owned.map((row) => row.orgId);
  const others = await db
    .select({ orgId: schema.orgMembers.orgId })
    .from(schema.orgMembers)
    .where(and(inArray(schema.orgMembers.orgId, ids), ne(schema.orgMembers.userId, userId)));
  const sharedIds = new Set(others.map((row) => row.orgId));
  return {
    solo: ids.filter((id) => !sharedIds.has(id)),
    shared: ids.filter((id) => sharedIds.has(id)),
  };
}

/**
 * Refuses to delete an account that still owns an organization other people
 * are in: they hand it over or empty it first. Everything they hold by
 * themselves goes with the account, in `beforeDelete`.
 *
 * Here rather than in `beforeDelete` because an APIError thrown from that
 * callback escapes better-auth's transaction wrapper as an unhandled
 * rejection, even though the caller still gets its 400.
 */
async function guardAccountDeletion(
  db: DB,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const session = await getSessionFromCtx(ctx);
  const userId = session?.user?.id;
  if (!userId) return;
  const { shared } = await ownedOrgsForDeletion(db, userId);
  if (shared.length > 0)
    throw new APIError("BAD_REQUEST", {
      message:
        "Some organizations still have other members. Hand over ownership or remove them first.",
    });
}

const DNS_CHECK_TIMEOUT = 3000;

async function domainHasMailRecords(domain: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(DNS_CHECK_TIMEOUT),
      },
    );
    if (!resp.ok) return false;
    // SAFETY: DNS-over-HTTPS answers this shape per RFC 8484's JSON form,
    // and every field read below is guarded before it is used.
    const data = (await resp.json()) as {
      Status: number;
      Answer?: { type: number }[];
    };
    if (data.Status !== 0) return false;
    if (data.Answer?.some((r) => r.type === 15)) return true;
    // No MX records: RFC 5321 says fall back to A/AAAA records for mail delivery.
    const aResp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`,
      {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(DNS_CHECK_TIMEOUT),
      },
    );
    if (!aResp.ok) return false;
    // SAFETY: the same JSON DNS shape as above, from the same resolver.
    const aData = (await aResp.json()) as {
      Status: number;
      Answer?: unknown[];
    };
    return aData.Status === 0 && (aData.Answer?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function makeDb(env: Env) {
  return drizzle(env.DB, { schema });
}
type Db = ReturnType<typeof makeDb>;

/**
 * Unauthenticated: anyone can post any address here. An already-verified
 * account must never receive a code, because verification auto-signs-in
 * (autoSignInAfterVerification), so a code would hand a full session to
 * whoever reads that inbox rather than merely confirm ownership.
 *
 * It answers as though it sent one anyway. Saying "already verified" told
 * an anonymous caller which addresses have verified accounts, one address
 * per request (#53). The reply is byte-identical to a real send; what
 * differs is that nothing goes out.
 */
/** What the two guarded better-auth endpoints are read for. Each field is
 * whatever arrived, reduced to the string the guard needs or to "". */
const otpSendBodySchema = v.object({ email: optionalText, type: optionalText });
const signUpBodySchema = v.object({ email: optionalText, name: optionalText });

/**
 * The request body better-auth is about to act on.
 *
 * better-auth types its hook context's body as unknown, because each of its
 * endpoints has a different one. The guards below parse what they read, so
 * this only has to get it as far as JSON.
 */
function bodyOf(ctx: { body?: unknown }): JsonValue {
  // SAFETY: better-auth parsed this out of a JSON request body, so it is JSON;
  // the schemas below are what decide it is the right JSON.
  return (ctx.body ?? {}) as JsonValue;
}

async function guardVerificationOTPSend(db: Db, rawBody: JsonValue) {
  const body = v.parse(otpSendBodySchema, rawBody ?? {});
  if (body.type !== "email-verification" || !body.email) return;
  const [existing] = await db
    .select({ emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.email, body.email.toLowerCase()));
  return existing?.emailVerified ? { success: true } : undefined;
}

/**
 * The reply a real signup gives when verification is still pending,
 * rebuilt from the caller's own input.
 *
 * Every field is either theirs (email, name), a fresh value (a new id, the
 * current time), or the column default a new row would carry, so it matches
 * a genuine response field for field. A shape that differed would be the
 * same oracle in a new place.
 */
function pendingSignUpResponse(email: string, name: string) {
  const timestamp = new Date().toISOString();
  return {
    token: null,
    user: {
      name,
      email,
      emailVerified: false,
      image: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      isAdmin: false,
      banned: false,
      plan: "free",
      polarSubscriptionCancelAtPeriodEnd: false,
      polarSubscriptionCurrentPeriodEnd: null,
      // Never the existing row's id: this account is not the caller's to
      // learn anything about. Same alphabet and length as better-auth's.
      id: uid(32),
    },
  };
}

/** Tells the address's real owner that someone tried to sign up as them. */
async function sendExistingAccountNotice(env: Env, email: string) {
  await sendEmail(
    env,
    email,
    "Someone tried to sign up with your rdyrct address",
    renderEmail({
      preheader: "You already have an rdyrct account.",
      heading: "Someone tried to sign up with your address",
      paragraphs: [
        "Someone just tried to create an rdyrct account with this address. Nothing changed, and no new account was made.",
        "If that was you, sign in instead. If you cannot remember your password, reset it.",
      ],
      cta: { label: "Sign in", url: `${env.APP_URL}/login` },
      note: "If this was not you, you can ignore this email. Nobody can use your address without reading this inbox.",
    }),
  );
}

/**
 * Signup used to answer a taken address with a plain USER_ALREADY_EXISTS,
 * which let anyone test addresses one at a time (#53). It now answers as it
 * would for a new account and creates nothing, and the address's real owner
 * gets an email saying so, since they are the only person entitled to know.
 *
 * That email carries no code and no session, which is the part better-auth's
 * own disguise got wrong for us: its version let the form walk on to the OTP
 * screen, mail a working code, and sign the visitor into the existing
 * account while the password they had just typed went nowhere.
 *
 * The cost is real and worth stating: someone who forgot they had an account
 * no longer learns it on screen. They learn it in the inbox they own.
 */
async function guardSignUp(
  env: Env,
  db: Db,
  rawBody: JsonValue,
): Promise<ReturnType<typeof pendingSignUpResponse> | undefined> {
  const body = v.parse(signUpBodySchema, rawBody ?? {});
  if (!body.email) return;
  const normalized = body.email.toLowerCase();

  // Before the existence check, so both branches answer a dead domain the
  // same way. Reversed, a 422 here would mean "no account on a domain that
  // cannot receive mail", and a success would mean "there is one".
  const domain = normalized.split("@")[1];
  if (domain && !(await domainHasMailRecords(domain)))
    throw new APIError(422, {
      message: "Enter a valid email address.",
      code: "INVALID_EMAIL_DOMAIN",
    });

  const [existing] = await db
    .select({ emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.email, normalized));
  if (!existing) return;

  // Only for a verified account. An unverified one carries on through the
  // OTP flow it was already in the middle of, and a code is on its way
  // there anyway: two emails would say the same thing twice.
  //
  // Sent after the response, never inside it. Awaiting it leaked the answer
  // twice over: a Resend outage made a registered address error while a free
  // one succeeded, and even on a good day the extra round trip made the
  // registered address measurably slower to answer. Both are the account
  // probe #53 set out to close, rebuilt in the fix for it.
  //
  // The failure is swallowed and alerted instead. The owner missing one
  // notice is the smaller loss, and we still hear about it even though they
  // did not.
  if (existing.emailVerified)
    afterResponse(
      sendExistingAccountNotice(env, normalized).catch((cause: unknown) =>
        alertBetterStack(env, [
          { event: "existing_account_notice_failed", error: String(cause) },
          // Deliberately no address: this log would otherwise be a list of
          // registered emails, which is the thing being protected.
        ]),
      ),
    );

  const name = body.name || normalized.split("@")[0];
  return pendingSignUpResponse(normalized, name);
}

function buildAuth(env: Env) {
  const db = makeDb(env);
  return betterAuth({
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    // Cloudflare Workers Rate Limiting bindings guard auth before BetterAuth.
    // Keeping BetterAuth's per-isolate limiter enabled would create a second,
    // inconsistent 429 shape and would not protect the rest of the app.
    rateLimit: { enabled: false },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // PBKDF2 via WebCrypto: native (fast) on Workers, unlike the default
      // scrypt implementation which burns CPU budget.
      password: {
        hash: (password) => hashPassword(password),
        verify: ({ hash, password }) => verifyPassword(password, hash),
      },
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          env,
          user.email,
          "Reset your rdyrct password",
          renderEmail({
            preheader: "Reset your password. The link lasts one hour.",
            heading: "Reset your password",
            paragraphs: [
              `Hi ${user.name},`,
              "Someone asked to reset the password for this account.",
            ],
            cta: { label: "Reset your password", url },
            note: "The link expires in one hour. If this was not you, ignore this email and nothing changes.",
          }),
        );
      },
    },
    emailVerification: {
      // The frontend is the single, deterministic sender of the verification
      // OTP (it calls send-verification-otp when it shows the code screen), so
      // suppress the implicit on-signup send that would otherwise fire and
      // race and duplicate the email.
      sendOnSignUp: false,
      // Still create the session when the OTP verifies (auto-sign-in).
      autoSignInAfterVerification: true,
    },
    // Email verification is a 6-digit OTP (not a link): the plugin's
    // overrideDefaultEmailVerification routes the requireEmailVerification
    // flow (including signup and unverified-login resends) through OTP.
    // Password reset stays a link (see sendResetPassword above).
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 60 * 10, // 10 minutes
        overrideDefaultEmailVerification: true,
        sendVerificationOnSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "email-verification") return;
          // The already-verified case is rejected up front in hooks.before
          // (see below): the plugin swallows whatever this callback returns
          // or throws, so blocking there is the only way for the caller to
          // learn "already verified" instead of waiting on a code that never
          // arrives.
          await sendEmail(
            env,
            email,
            "Your rdyrct verification code",
            renderEmail({
              preheader: `${otp} is your rdyrct verification code.`,
              heading: "Your verification code",
              paragraphs: ["Enter this code to finish signing in."],
              code: otp,
              note: "The code expires in 10 minutes.",
            }),
          );
        },
      }),
    ],
    user: {
      additionalFields: {
        isAdmin: { type: "boolean", defaultValue: false, input: false },
        // Suspended by a platform admin; flipped only via the admin API.
        banned: { type: "boolean", defaultValue: false, input: false },
        // Per-user subscription; flipped by the Polar webhook, never by input.
        plan: { type: "string", defaultValue: "free", input: false },
        polarSubscriptionCancelAtPeriodEnd: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
        polarSubscriptionCurrentPeriodEnd: {
          type: "number",
          defaultValue: null,
          input: false,
        },
      },
      // Self-service account deletion. Authored links/invites keep working
      // (ON DELETE SET NULL) and memberships cascade, so a non-owner deletes
      // cleanly, but an org needs exactly one owner, so an owner must
      // delete or transfer their orgs first.
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          // Every account owns an organization from its first session, so
          // refusing outright (as this used to) would make every account
          // undeletable. What is theirs alone goes with the account, through
          // the same teardown the Settings button uses, so R2 objects and KV
          // keys are cleaned up rather than orphaned.
          //
          // The refusal for organizations with other members happens earlier,
          // in hooks.before: an APIError thrown from here escapes better-auth's
          // transaction wrapper as an unhandled rejection, even though the
          // caller does get its 400.
          const { solo } = await ownedOrgsForDeletion(db, user.id);
          // Together: each teardown is an independent workflow keyed by its
          // own org, and a person deletes at most three.
          await Promise.all(solo.map((orgId) => deleteOrg(db, env, orgId)));
        },
      },
    },
    hooks: {
      // Returning a value here short-circuits: better-auth sends it as the
      // response instead of running the endpoint. Both guards use that to
      // answer exactly as the real path would while doing nothing (#53).
      before: createAuthMiddleware(async (ctx) => {
        // Cap (#98) sits in front of the two paths a bot actually wants:
        // creating accounts, and making us send mail. Not login, where a bot
        // with correct credentials is not the threat and every real visitor
        // would pay the tax.
        const capScope = lookup(CAP_GUARDED_PATHS, ctx.path);
        if (capScope) {
          // In a header, not the body: better-auth validates each endpoint's
          // body against its own schema, and an extra key there is at the
          // mercy of that schema.
          const token = ctx.headers?.get(CAP_TOKEN_HEADER) ?? "";
          if (!(await spendToken(env, capScope, token)))
            // A code, not just a message: the browser retries this once with
            // a freshly solved token, and matching on prose to decide that
            // would break the first time the wording changed.
            throw new APIError("BAD_REQUEST", {
              code: CAP_FAILED_CODE,
              message: "Could not verify you are human. Reload the page and try again.",
            });
        }
        if (ctx.path === "/delete-user") await guardAccountDeletion(db, ctx);
        if (ctx.path === "/email-otp/send-verification-otp") {
          return guardVerificationOTPSend(db, bodyOf(ctx));
        }
        if (ctx.path === "/sign-up/email") {
          return guardSignUp(env, db, bodyOf(ctx));
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // The superadmin is pinned by secret: the account signing up with
          // SUPERADMIN_EMAIL is the platform admin (and always lands on Pro,
          // so all Pro-gated features are reachable). No first-signup rule.
          before: async (user) => {
            const isSuper = user.email.toLowerCase() === env.SUPERADMIN_EMAIL.toLowerCase();
            return {
              data: {
                ...user,
                isAdmin: isSuper,
                plan: isSuper ? "pro" : "free",
              },
            };
          },
        },
      },
      session: {
        create: {
          // Banned accounts can't start a session (existing ones are wiped by
          // the ban). Throwing aborts creation with this message on sign-in.
          before: async (session) => {
            const rows = await db
              .select({ banned: schema.user.banned })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId));
            if (rows[0]?.banned)
              throw new APIError(403, {
                message: "This account has been suspended.",
              });
          },
          after: async (session) => {
            await ensureOrganization(env, db, session.userId);
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;

// Bindings are stable per isolate, so one instance serves every request.
let cached: Auth | null = null;

export function getAuth(env: Env): Auth {
  cached ??= buildAuth(env);
  return cached;
}
