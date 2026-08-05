import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "./db/schema";
import type { Env } from "./env";
import { sendEmail } from "./email";
import { renderEmail } from "./email-layout";
import { hashPassword, verifyPassword } from "./password";
import { uid } from "./util";

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
async function guardVerificationOTPSend(db: Db, body: { email?: unknown; type?: unknown } | null) {
  if (body?.type !== "email-verification" || typeof body.email !== "string") return;
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
      heading: "You already have an account",
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
  body: { email?: unknown; name?: unknown } | null,
): Promise<ReturnType<typeof pendingSignUpResponse> | undefined> {
  const email = body?.email;
  if (typeof email !== "string") return;
  const normalized = email.toLowerCase();

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
  if (existing.emailVerified) await sendExistingAccountNotice(env, normalized);

  const name = typeof body?.name === "string" ? body.name : normalized.split("@")[0];
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
          const owned = await db
            .select({ orgId: schema.orgMembers.orgId })
            .from(schema.orgMembers)
            .where(and(eq(schema.orgMembers.userId, user.id), eq(schema.orgMembers.role, "owner")));
          if (owned.length > 0)
            throw new APIError(400, {
              message: "You still own organizations, delete them first in Settings.",
            });
        },
      },
    },
    hooks: {
      // Returning a value here short-circuits: better-auth sends it as the
      // response instead of running the endpoint. Both guards use that to
      // answer exactly as the real path would while doing nothing (#53).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/email-otp/send-verification-otp") {
          return guardVerificationOTPSend(
            db,
            ctx.body as { email?: unknown; type?: unknown } | null,
          );
        }
        if (ctx.path === "/sign-up/email") {
          return guardSignUp(env, db, ctx.body as { email?: unknown; name?: unknown } | null);
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
