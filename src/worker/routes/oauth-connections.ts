import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
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

interface OAuthConnectionDTO {
  id: string;
  clientId: string;
  clientName: string;
  /** When the person approved it. */
  createdAt: number;
  /** The newest token the client was issued (a client refreshes about
   * hourly while in use), or the approval itself if it was issued none:
   * "last active", to within the hour. */
  lastUsedAt: number;
}

// The caller's own grants, with the client's name and when it last got a
// token. The app used to ask better-auth for the consents and then the
// public client once per row; one query is the same data in one trip.
oauthConnectionRoutes.get("/", requireUser, async (c) => {
  const db = c.var.db;
  const user = c.var.user!;

  const consents = await db
    .select({
      id: schema.oauthConsent.id,
      clientId: schema.oauthConsent.clientId,
      createdAt: schema.oauthConsent.createdAt,
      updatedAt: schema.oauthConsent.updatedAt,
      clientName: schema.oauthClient.name,
    })
    .from(schema.oauthConsent)
    .leftJoin(schema.oauthClient, eq(schema.oauthClient.clientId, schema.oauthConsent.clientId))
    .where(eq(schema.oauthConsent.userId, user.id))
    .orderBy(desc(schema.oauthConsent.createdAt));

  const [access, refresh] = await Promise.all([
    db
      .select({ clientId: schema.oauthAccessToken.clientId, at: schema.oauthAccessToken.createdAt })
      .from(schema.oauthAccessToken)
      .where(eq(schema.oauthAccessToken.userId, user.id)),
    db
      .select({
        clientId: schema.oauthRefreshToken.clientId,
        at: schema.oauthRefreshToken.createdAt,
      })
      .from(schema.oauthRefreshToken)
      .where(eq(schema.oauthRefreshToken.userId, user.id)),
  ]);
  const lastUsed = new Map<string, number>();
  for (const { clientId, at } of [...access, ...refresh]) {
    if (at && at.getTime() > (lastUsed.get(clientId) ?? 0)) lastUsed.set(clientId, at.getTime());
  }

  const connections: OAuthConnectionDTO[] = consents.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName || row.clientId,
    createdAt: row.createdAt?.getTime() ?? 0,
    lastUsedAt: Math.max(
      lastUsed.get(row.clientId) ?? 0,
      row.updatedAt?.getTime() ?? 0,
      row.createdAt?.getTime() ?? 0,
    ),
  }));
  return c.json(connections);
});

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
