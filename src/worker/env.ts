import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./db/schema";

export interface Env {
  DB: D1Database;
  LINKS: KVNamespace;
  ASSETS: Fetcher;
}

export type DB = DrizzleD1Database<typeof schema>;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export type Vars = {
  db: DB;
  user: SessionUser | null;
};

export type AppEnv = { Bindings: Env; Variables: Vars };
