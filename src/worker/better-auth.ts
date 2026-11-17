import { betterAuth } from "better-auth";
import type { JsonValue } from "../shared/types";
import { optionalText, parseOptionalBody } from "./schemas";
import * as v from "valibot";
import { lookup } from "../shared/lookup";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { jwt } from "better-auth/plugins/jwt";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "./db/schema";
import type { DB, Env } from "./env";
import { captureAlert } from "./sentry";
import { afterResponse } from "./background";
import { sendWelcomeOnce } from "./welcome";
import { emailConfigured, sendEmail } from "./email";
import { NOTICE_FOOTER, renderEmail } from "./email-layout";
import { hashPassword, verifyPassword } from "./password";
import { uid } from "./util";
import { spendToken, type TurnstileScope } from "./turnstile";
import { storeUserAvatar, deleteUserAvatar } from "./storage";
import { createOwnedOrg } from "./plan";
import { defaultOrgName } from "@/shared/org-name";
import { TURNSTILE_FAILED_CODE, TURNSTILE_TOKEN_HEADER } from "@/shared/types";
import { mcpResource, fetchClientMetadataResource } from "./mcp-oauth";
import { HTTPException } from "hono/http-exception";
import { endSubscriptionBeforeDelete } from "./routes/billing";
import { logFailure } from "./log-failure";

const SUBSCRIPTION_NOT_ENDED =
  "We could not cancel the subscription, so the account was not deleted. Try again in a few minutes.";

/** Keyed by `ctx.path`, which is relative to /api/auth. */
const TURNSTILE_GUARDED_PATHS = {
  "/sign-up/email": "signup",
  "/request-password-reset": "password-reset",
} satisfies Record<string, TurnstileScope>;

const IdTokenClaims = v.object({ email: v.pipe(v.string(), v.email()) });

/** Not a signature check, and it needs none: the token came from Google's token endpoint over TLS and the address is only shown to the account's own holder. */
export function googleEmailOf(idToken: string | null | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = v.safeParse(IdTokenClaims, JSON.parse(json));
    return claims.success ? claims.output.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Every account owns one org from its first session, not its creation: a signup that never
 * passes the code leaves nothing behind. Failure is swallowed so nobody is locked out; the
 * client has a create-org form.
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
      // One, not the plan's allowance. The read above is a fast path, not the guard: on Pro
      // (allowance three) two sessions created at once would both have room and make two orgs.
      ownedOrgLimit: 1,
    });
  } catch (error) {
    logFailure("default_org_failed", error);
  }
}

/**
 * An org has no plan of its own (`orgPlan()` reads its owner's), so every owned org goes too.
 * Deleting here in one D1 batch with the flags means a refused write rolls both back (#119).
 * Workflows start last; a paying account ends its Polar subscription first or this throws a 503 (#337).
 */
export async function deleteAccountAndOwnedOrgs(env: Env, userId: string): Promise<void> {
  if (!(await endSubscriptionBeforeDelete(env, userId))) {
    throw new HTTPException(503, { message: SUBSCRIPTION_NOT_ENDED });
  }
  await deleteUserAvatar(env, userId);
  const now = Date.now();
  const [owned] = await env.DB.batch<{ orgId: string }>([
    env.DB.prepare(
      "select org_id as orgId from org_members where user_id = ? and role = 'owner'",
    ).bind(userId),
    env.DB.prepare(
      `update orgs set deleting_at = ?
       where deleting_at is null and id in (
         select org_id from org_members where user_id = ? and role = 'owner'
       )`,
    ).bind(now, userId),
    env.DB.prepare("delete from user where id = ?").bind(userId),
  ]);
  const orgIds = owned.results.map((row) => row.orgId);
  if (orgIds.length === 0) return;
  try {
    await env.ORG_DELETE.createBatch(orgIds.map((orgId) => ({ id: orgId, params: { orgId } })));
  } catch (error) {
    captureAlert([{ event: "account_org_delete_start_failed", userId, count: orgIds.length }]);
    logFailure("account_org_delete_start_failed", error, { userId });
  }
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
 * Unauthenticated. A verified account must never receive a code (verification auto-signs-in).
 * It answers as if it sent one, byte-identical to a real send, since "already verified"
 * revealed which addresses have accounts (#53).
 */
const otpSendBodySchema = v.object({ email: optionalText, type: optionalText });
const signUpBodySchema = v.object({ email: optionalText, name: optionalText });

function bodyOf(ctx: { body?: unknown }): JsonValue {
  // SAFETY: better-auth parsed this out of a JSON request body, so it is JSON;
  // the schemas below are what decide it is the right JSON.
  return (ctx.body ?? {}) as JsonValue;
}

async function guardVerificationOTPSend(db: Db, rawBody: JsonValue) {
  const body = parseOptionalBody(otpSendBodySchema, rawBody);
  if (body.type !== "email-verification" || !body.email) return;
  const [existing] = await db
    .select({ emailVerified: schema.user.emailVerified })
    .from(schema.user)
    .where(eq(schema.user.email, body.email.toLowerCase()));
  return existing?.emailVerified ? { success: true } : undefined;
}

/**
 * Every field is the caller's own, a fresh value, or the column default a new row would
 * carry, so it matches a genuine response field for field. A different shape would be
 * the same oracle in a new place.
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
      polarSubscriptionInterval: null,
      lastSeenAt: null,
      // Never the existing row's id: this account is not the caller's to learn anything about.
      id: uid(32),
    },
  };
}

async function sendExistingAccountNotice(env: Env, email: string) {
  await sendEmail(
    env,
    email,
    "Someone tried to sign up with your rdyrct address",
    renderEmail(
      {
        preheader: "You already have an rdyrct account.",
        heading: "Someone tried to sign up with your address",
        paragraphs: [
          "Someone just tried to create an rdyrct account with this address. Nothing changed, and no new account was made.",
          "If that was you, sign in instead. If you cannot remember your password, reset it.",
        ],
        cta: { label: "Sign in", url: `${env.APP_URL}/login` },
        note: "If this was not you, you can ignore this email. Nobody can use your address without reading this inbox.",
        footerLine: NOTICE_FOOTER,
      },
      env.APP_URL,
      email,
    ),
  );
}

/**
 * A taken address answers as for a new account and creates nothing (#53); the real owner
 * gets an email with no code and no session. better-auth's own disguise mailed a working
 * code and signed the visitor into the existing account.
 */
async function guardSignUp(
  env: Env,
  db: Db,
  rawBody: JsonValue,
): Promise<ReturnType<typeof pendingSignUpResponse> | undefined> {
  const body = parseOptionalBody(signUpBodySchema, rawBody);
  if (!body.email) return;
  const normalized = body.email.toLowerCase();

  // Before the existence check, so both branches answer a dead domain the same way.
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

  // Verified accounts only. Sent after the response: awaiting leaked the answer through a
  // Resend outage and a slower round trip (#53). Failure is swallowed and alerted.
  if (existing.emailVerified)
    afterResponse(
      sendExistingAccountNotice(env, normalized).catch((cause: unknown) =>
        captureAlert([
          { event: "existing_account_notice_failed", error: String(cause) },
          // No address: this log would otherwise be a list of registered emails.
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
        jwks: schema.jwks,
        oauthClient: schema.oauthClient,
        oauthResource: schema.oauthResource,
        oauthClientResource: schema.oauthClientResource,
        oauthRefreshToken: schema.oauthRefreshToken,
        oauthAccessToken: schema.oauthAccessToken,
        oauthConsent: schema.oauthConsent,
        oauthClientAssertion: schema.oauthClientAssertion,
      },
    }),
    // Workers Rate Limiting bindings guard auth first. BetterAuth's own limiter would add a second, inconsistent 429 shape.
    rateLimit: { enabled: false },
    // One query for session and user: every signed-in API call starts here, and a D1 round trip is ~25 ms.
    advanced: { database: { joins: true } },
    // Google is a trusted IdP, so an unverified Google account still links to a verified local one.
    account: {
      additionalFields: {
        email: { type: "string", required: false, input: false },
      },
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        // No updateUserInfoOnLink: linking Google must not overwrite a name the user set.
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: emailConfigured(env),
      // Native on Workers, unlike the default scrypt, which burns CPU budget.
      password: {
        hash: (password) => hashPassword(password),
        verify: ({ hash, password }) => verifyPassword(password, hash),
      },
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          env,
          user.email,
          "Reset your rdyrct password",
          renderEmail(
            {
              preheader: "Reset your password. The link lasts one hour.",
              heading: "Reset your password",
              paragraphs: [
                `Hi ${user.name},`,
                "Someone asked to reset the password for this account.",
              ],
              cta: { label: "Reset your password", url },
              note: "The link expires in one hour. If this was not you, ignore this email and nothing changes.",
            },
            env.APP_URL,
            user.email,
          ),
        );
      },
    },
    emailVerification: {
      // The frontend sends the verification OTP, so suppress the implicit on-signup send that would duplicate it.
      sendOnSignUp: false,
      autoSignInAfterVerification: true,
    },
    // overrideDefaultEmailVerification routes requireEmailVerification through OTP. Password reset stays a link.
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 60 * 10, // 10 minutes
        overrideDefaultEmailVerification: true,
        sendVerificationOnSignUp: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "email-verification") return;
          // The plugin swallows what this callback returns or throws, so "already verified" is rejected up front in hooks.before.
          await sendEmail(
            env,
            email,
            "Your rdyrct verification code",
            renderEmail(
              {
                preheader: `${otp} is your rdyrct verification code.`,
                heading: "Your verification code",
                paragraphs: ["Enter this code to finish signing in."],
                code: otp,
                note: "The code expires in 10 minutes.",
              },
              env.APP_URL,
              email,
            ),
          );
        },
      }),
      // The generic OAuth2 provider, not the built-in `google`, whose token endpoint is hardcoded and cannot be redirected at the dev emulator.
      // Registered only when credentials are present.
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? [
            genericOAuth({
              config: [
                {
                  providerId: "google",
                  clientId: env.GOOGLE_CLIENT_ID,
                  clientSecret: env.GOOGLE_CLIENT_SECRET,
                  scopes: ["openid", "email", "profile"],
                  ...(env.GOOGLE_EMULATOR_URL
                    ? {
                        authorizationUrl: `${env.GOOGLE_EMULATOR_URL}/o/oauth2/v2/auth`,
                        tokenUrl: `${env.GOOGLE_EMULATOR_URL}/oauth2/token`,
                        userInfoUrl: `${env.GOOGLE_EMULATOR_URL}/oauth2/v2/userinfo`,
                      }
                    : {
                        discoveryUrl:
                          "https://accounts.google.com/.well-known/openid-configuration",
                      }),
                },
              ],
            }),
          ]
        : []),
      // MCP OAuth (#139): jwt() supplies the signing key for access tokens. Open registration is rate-limited,
      // and sweepAbandonedOAuthClients() deletes rows nobody consented to. client_credentials is left out: it would
      // let a client act with no user. No set-auth-jwt header: producing it signed a token on every session lookup.
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: "/login",
        consentPage: "/consent",
        resource: mcpResource(env),
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        grantTypes: ["authorization_code", "refresh_token"],
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
    user: {
      additionalFields: {
        isAdmin: { type: "boolean", defaultValue: false, input: false },
        banned: { type: "boolean", defaultValue: false, input: false },
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
        polarSubscriptionInterval: { type: "string", required: false, input: false },
        // Read with the session so withSession can tell an hour-old mark from a fresh one without a query (#489).
        lastSeenAt: { type: "number", required: false, input: false },
      },
      // Authored links keep working (ON DELETE SET NULL); owned orgs are flagged in the same D1 batch.
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          try {
            await deleteAccountAndOwnedOrgs(env, user.id);
          } catch (error) {
            if (error instanceof HTTPException && error.status === 503) {
              throw new APIError("SERVICE_UNAVAILABLE", { message: SUBSCRIPTION_NOT_ENDED });
            }
            throw error;
          }
        },
      },
    },
    hooks: {
      // A returned value short-circuits: better-auth sends it as the response (#53).
      before: createAuthMiddleware(async (ctx) => {
        // Turnstile (#304) guards account creation and mail sending. Not login: a bot with correct credentials is no threat.
        const capScope = lookup(TURNSTILE_GUARDED_PATHS, ctx.path);
        if (capScope) {
          // In a header: an extra body key is at the mercy of each endpoint's schema.
          const token = ctx.headers?.get(TURNSTILE_TOKEN_HEADER) ?? "";
          if (!(await spendToken(env, capScope, token)))
            // A code, so the browser's one retry with a fresh token does not break when the wording changes.
            throw new APIError("BAD_REQUEST", {
              code: TURNSTILE_FAILED_CODE,
              message: "Could not verify you are human. Reload the page and try again.",
            });
        }
        if (ctx.path === "/email-otp/send-verification-otp") {
          return guardVerificationOTPSend(db, bodyOf(ctx));
        }
        if (ctx.path === "/sign-up/email") {
          return guardSignUp(env, db, bodyOf(ctx));
        }
      }),
    },
    databaseHooks: {
      // Kept on link (create) and refreshed on each sign-in (update). A password account has no id token.
      account: {
        create: {
          before: async (account) => {
            const email = googleEmailOf(account.idToken);
            return email ? { data: { ...account, email } } : undefined;
          },
        },
        update: {
          before: async (account) => {
            const email = googleEmailOf(account.idToken);
            return email ? { data: { ...account, email } } : undefined;
          },
        },
      },
      user: {
        create: {
          // The account signing up with SUPERADMIN_EMAIL is the platform admin, always on Pro.
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
          after: async (user) => {
            afterResponse(sendWelcomeOnce(env, db, user));
          },
        },
        // A password account is verified by an update; the claim inside sendWelcomeOnce makes later updates no-ops.
        update: {
          after: async (user) => {
            afterResponse(sendWelcomeOnce(env, db, user));
          },
        },
      },
      session: {
        create: {
          // Existing sessions are wiped by the ban; throwing aborts creation.
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
            // The OAuth path refreshes `user.image` to the remote URL each time. Runs after the org ensure.
            // A failure must not abort sign-in: it is swallowed and the re-sync runs next login.
            try {
              const [row] = await db
                .select({ image: schema.user.image })
                .from(schema.user)
                .where(eq(schema.user.id, session.userId));
              if (row?.image?.startsWith("http")) {
                const serving = await storeUserAvatar(env, session.userId, row.image);
                if (serving)
                  await db
                    .update(schema.user)
                    .set({ image: serving })
                    .where(eq(schema.user.id, session.userId));
              }
            } catch {}
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let cached: Auth | null = null;

export function getAuth(env: Env): Auth {
  cached ??= buildAuth(env);
  return cached;
}
