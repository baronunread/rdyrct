import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireUser } from "../guards";

// Mounted at /api/oauth-connections. Per-user, not per-org: an OAuth grant
// (#139 follow-up) is a session action a member takes for themselves, not a
// standing credential an owner mints (see api-keys.ts for that one).
//
// better-auth's own POST /api/auth/oauth2/delete-consent only deletes the
// oauthConsent row — it does not touch the tokens that consent already
// minted, so a client already holding a refresh token keeps minting fresh
// access tokens from it after "revoking" there. This route is what makes
// disconnecting real: it deletes the consent AND every access/refresh token
// this user granted that client, in one place, so hooks.ts's
// useRevokeConnectedApp has one call that actually revokes.
//
// It does not, and cannot, kill a still-valid access token already handed to
// the client: those are verified statelessly (session.ts's JWT check has no
// DB read), the same tradeoff requireMcpAuth itself makes. That token dies
// on its own within the hour (accessTokenExpiresIn's default) — the same
// window a stolen session cookie or API key already has.
export const oauthConnectionRoutes = new Hono<AppEnv>();

oauthConnectionRoutes.delete("/:consentId", requireUser, async (c) => {
  const db = c.var.db;
  const user = c.var.user!;
  const consentId = c.req.param("consentId");

  const rows = await db
    .select({ clientId: schema.oauthConsent.clientId })
    .from(schema.oauthConsent)
    .where(and(eq(schema.oauthConsent.id, consentId), eq(schema.oauthConsent.userId, user.id)));
  const consent = rows[0];
  if (!consent) throw new HTTPException(404, { message: "Connection not found" });

  await db.batch([
    db
      .delete(schema.oauthAccessToken)
      .where(
        and(
          eq(schema.oauthAccessToken.clientId, consent.clientId),
          eq(schema.oauthAccessToken.userId, user.id),
        ),
      ),
    db
      .delete(schema.oauthRefreshToken)
      .where(
        and(
          eq(schema.oauthRefreshToken.clientId, consent.clientId),
          eq(schema.oauthRefreshToken.userId, user.id),
        ),
      ),
    db.delete(schema.oauthConsent).where(eq(schema.oauthConsent.id, consentId)),
  ]);

  const log = c.get("log");
  log.audit({
    action: "oauth_connection.revoke",
    actor: { type: "user", id: user.id },
    target: { type: "oauth_client", id: consent.clientId },
    outcome: "success",
  });

  return c.json({ ok: true });
});
