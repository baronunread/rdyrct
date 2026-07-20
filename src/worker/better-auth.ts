import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "./db/schema";
import type { Env } from "./env";
import { sendEmail } from "./email";
import { hashPassword, verifyPassword } from "./password";

function buildAuth(env: Env) {
  const db = drizzle(env.DB, { schema });
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
          `<p>Hi ${user.name},</p>
           <p>Someone requested a password reset for this account. If that was
           you, <a href="${url}">reset your password</a>. The link expires in
           one hour; otherwise you can ignore this email.</p>`,
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
          await sendEmail(
            env,
            email,
            "Your rdyrct verification code",
            `<p>Your rdyrct verification code is
             <strong style="font-size:20px;letter-spacing:2px">${otp}</strong>.</p>
             <p>It expires in 10 minutes.</p>`,
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
            .where(
              and(
                eq(schema.orgMembers.userId, user.id),
                eq(schema.orgMembers.role, "owner"),
              ),
            );
          if (owned.length > 0)
            throw new APIError(400, {
              message:
                "You still own organizations, delete or transfer them first.",
            });
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // The superadmin is pinned by secret: the account signing up with
          // SUPERADMIN_EMAIL is the platform admin (and always lands on Pro,
          // so all Pro-gated features are reachable). No first-signup rule.
          before: async (user) => {
            const isSuper =
              user.email.toLowerCase() === env.SUPERADMIN_EMAIL.toLowerCase();
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
