import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { AppEnv } from "../env";
import {
  hashPassword,
  verifyPassword,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  requireUser,
} from "../auth";
import { uid, now } from "../util";
import type { Me } from "@/shared/types";

export const authRoutes = new Hono<AppEnv>();

async function meFor(
  db: AppEnv["Variables"]["db"],
  user: NonNullable<AppEnv["Variables"]["user"]>,
): Promise<Me> {
  const rows = await db
    .select({
      id: schema.orgs.id,
      name: schema.orgs.name,
      role: schema.orgMembers.role,
    })
    .from(schema.orgMembers)
    .innerJoin(schema.orgs, eq(schema.orgMembers.orgId, schema.orgs.id))
    .where(eq(schema.orgMembers.userId, user.id));
  return { user, orgs: rows };
}

authRoutes.post("/signup", async (c) => {
  const body = await c.req.json<{
    email?: string;
    name?: string;
    password?: string;
    orgName?: string;
  }>();
  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();
  const password = body.password ?? "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HTTPException(400, { message: "Valid email required" });
  if (!name) throw new HTTPException(400, { message: "Name required" });
  if (password.length < 8)
    throw new HTTPException(400, { message: "Password must be 8+ characters" });

  const db = c.var.db;
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email));
  if (existing.length)
    throw new HTTPException(409, { message: "Email already registered" });

  // First user to sign up becomes the platform admin.
  const anyUser = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .limit(1);
  const isAdmin = anyUser.length === 0;

  const userId = uid();
  const ts = now();
  await db.insert(schema.users).values({
    id: userId,
    email,
    name,
    passwordHash: await hashPassword(password),
    isAdmin,
    createdAt: ts,
  });

  const orgName = body.orgName?.trim() || `${name}'s org`;
  const orgId = uid();
  await db.insert(schema.orgs).values({ id: orgId, name: orgName, createdAt: ts });
  await db
    .insert(schema.orgMembers)
    .values({ orgId, userId, role: "owner", createdAt: ts });

  const token = await createSession(db, userId);
  setSessionCookie(c, token);
  const user = { id: userId, email, name, isAdmin };
  return c.json(await meFor(db, user));
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim().toLowerCase() ?? "";
  const rows = await c.var.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email));
  const user = rows[0];
  if (!user || !(await verifyPassword(body.password ?? "", user.passwordHash)))
    throw new HTTPException(401, { message: "Invalid email or password" });

  const token = await createSession(c.var.db, user.id);
  setSessionCookie(c, token);
  return c.json(
    await meFor(c.var.db, {
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
    }),
  );
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, "sid");
  if (token)
    await c.var.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.token, token));
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, async (c) => {
  return c.json(await meFor(c.var.db, c.var.user!));
});
