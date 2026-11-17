import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireUser } from "../guards";

// Per-user, not per-org. better-auth's delete-consent leaves the tokens that consent
// minted, so a refresh token keeps working: this route deletes the consent AND its tokens.
// A still-valid access token is not killed (verified statelessly) and expires within the hour.
export const oauthConnectionRoutes = new Hono<AppEnv>();

interface OAuthConnectionDTO {
  id: string;
  clientId: string;
  clientName: string;
  createdAt: number;
  lastUsedAt: number;
}

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
  const log = c.get("log");
  log.set({ oauthConnections: { count: connections.length } });
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
  const log = c.get("log");
  log.set({ oauthConnection: { consentId, clientId: consent?.clientId, found: !!consent } });
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

  log.audit({
    action: "oauth_connection.revoke",
    actor: { type: "user", id: user.id },
    target: { type: "oauth_client", id: consent.clientId },
    outcome: "success",
  });

  return c.json({ ok: true });
});
