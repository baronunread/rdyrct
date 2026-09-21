import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as v from "valibot";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import { requireOrgRole } from "../org-role";
import { generateApiKey, hashApiKey } from "../api-keys";
import { uid } from "../util";
import { jsonBodyLimit } from "../body-limit";
import { parseBody } from "../schemas";
import type { ApiKeyDTO } from "@/shared/types";

// Mounted at /api/orgs/:orgId/api-keys. Owner-only: minting a credential that
// can act as the account is the same trust level as changing who has it, and
// there is one credential per user (session.ts), not one per org.
export const apiKeyRoutes = new Hono<AppEnv>();
apiKeyRoutes.use("*", jsonBodyLimit());

const createInput = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
});

function dtoOf(row: typeof schema.apiKeys.$inferSelect): ApiKeyDTO {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

apiKeyRoutes.get("/", requireOrgRole("owner"), async (c) => {
  const rows = await c.var.db
    .select()
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.userId, c.var.user!.id), isNull(schema.apiKeys.revokedAt)))
    .orderBy(desc(schema.apiKeys.createdAt));
  return c.json(rows.map(dtoOf));
});

apiKeyRoutes.post("/", requireOrgRole("owner"), async (c) => {
  const log = c.get("log");
  const body = parseBody(createInput, await c.req.json());
  const { raw, prefix } = generateApiKey();
  const row = {
    id: uid(),
    userId: c.var.user!.id,
    name: body.name,
    keyHash: await hashApiKey(raw),
    keyPrefix: prefix,
    createdAt: Date.now(),
    lastUsedAt: null,
    revokedAt: null,
  } satisfies typeof schema.apiKeys.$inferInsert;
  await c.var.db.insert(schema.apiKeys).values(row);

  log.audit({
    action: "api_key.create",
    actor: { type: "user", id: c.var.user!.id },
    target: { type: "api_key", id: row.id },
    outcome: "success",
  });
  // The only point the raw value is ever readable again: only its hash is
  // stored, so a key shown here and lost has to be revoked and reissued.
  return c.json({ ...dtoOf(row), key: raw } satisfies ApiKeyDTO, 201);
});

apiKeyRoutes.delete("/:keyId", requireOrgRole("owner"), async (c) => {
  const log = c.get("log");
  const keyId = c.req.param("keyId");
  const result = await c.var.db
    .update(schema.apiKeys)
    .set({ revokedAt: Date.now() })
    .where(
      and(
        eq(schema.apiKeys.id, keyId),
        eq(schema.apiKeys.userId, c.var.user!.id),
        isNull(schema.apiKeys.revokedAt),
      ),
    );
  if (result.meta.changes === 0) throw new HTTPException(404, { message: "Key not found" });

  log.audit({
    action: "api_key.revoke",
    actor: { type: "user", id: c.var.user!.id },
    target: { type: "api_key", id: keyId },
    outcome: "success",
  });
  return c.json({ ok: true });
});
