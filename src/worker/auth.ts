import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq, and } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { AppEnv, DB, SessionUser } from "./env";
import type { OrgRole } from "@/shared/types";
import { uid, now } from "./util";

const PBKDF2_ITERATIONS = 150_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE = "sid";

const b64 = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${b64(salt.buffer)}:${b64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, iterations, saltB64, hashB64] = stored.split(":");
  if (scheme !== "pbkdf2") return false;
  const expected = unb64(hashB64);
  const actual = new Uint8Array(
    await pbkdf2(password, unb64(saltB64), Number(iterations)),
  );
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export async function createSession(db: DB, userId: string): Promise<string> {
  const token = uid(32);
  await db.insert(schema.sessions).values({
    token,
    userId,
    expiresAt: now() + SESSION_TTL_MS,
  });
  return token;
}

export function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: new URL(c.req.url).protocol === "https:",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE, { path: "/" });
}

/** Attaches db + user (if a valid session cookie is present) to context. */
export const withSession = createMiddleware<AppEnv>(async (c, next) => {
  const db = drizzle(c.env.DB, { schema });
  c.set("db", db);
  c.set("user", null);

  const token = getCookie(c, COOKIE);
  if (token) {
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        isAdmin: schema.users.isAdmin,
        expiresAt: schema.sessions.expiresAt,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
      .where(eq(schema.sessions.token, token));
    const row = rows[0];
    if (row && row.expiresAt > now()) {
      c.set("user", {
        id: row.id,
        email: row.email,
        name: row.name,
        isAdmin: row.isAdmin,
      });
    }
  }
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user) throw new HTTPException(401, { message: "Not signed in" });
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user?.isAdmin)
    throw new HTTPException(403, { message: "Admin only" });
  await next();
});

const ROLE_RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

/**
 * Resolves the caller's role in the :orgId route param. Platform admins pass
 * every check (they act as owner everywhere, like a cloud super admin).
 */
export async function orgRole(
  db: DB,
  user: SessionUser,
  orgId: string,
): Promise<OrgRole | null> {
  if (user.isAdmin) return "owner";
  const rows = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(
      and(
        eq(schema.orgMembers.orgId, orgId),
        eq(schema.orgMembers.userId, user.id),
      ),
    );
  return rows[0]?.role ?? null;
}

export function requireOrgRole(min: OrgRole) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    if (!user) throw new HTTPException(401, { message: "Not signed in" });
    const orgId = c.req.param("orgId");
    if (!orgId) throw new HTTPException(400, { message: "Missing org id" });
    const role = await orgRole(c.var.db, user, orgId);
    if (!role || ROLE_RANK[role] < ROLE_RANK[min])
      throw new HTTPException(403, { message: "Insufficient role" });
    await next();
  });
}
