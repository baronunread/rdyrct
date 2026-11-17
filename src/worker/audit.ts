/**
 * Best-effort and never blocks the action: an admin stopping a phishing link
 * must not be refused because a log insert failed (#67).
 */
import { drizzle } from "drizzle-orm/d1";
import type { JsonValue } from "../shared/types";
import * as schema from "./db/schema";
import type { Env } from "./env";
import { captureAlert } from "./sentry";
import { uid } from "./util";

export type AdminAction =
  | "link.suspend"
  | "link.unsuspend"
  | "link.delete"
  | "link.rescore"
  | "link.warn"
  | "link.unwarn"
  | "org.suspend_links"
  | "org.unsuspend_links"
  | "org.delete"
  | "org.reviewed"
  | "org.abuse"
  | "host.block"
  | "host.unblock"
  | "report.dismiss"
  | "user.ban"
  | "user.unban"
  | "user.delete"
  | "user.comp_grant"
  | "user.comp_revoke"
  | "plan.change"
  | "user.limits"
  | "anon_link.delete";

export interface AdminActionEntry {
  actorUserId: string;
  action: AdminAction;
  targetType: "link" | "org" | "user" | "anon_link" | "report" | "host";
  targetId: string;
  detail?: Record<string, JsonValue>;
}

export async function recordAdminAction(env: Env, entry: AdminActionEntry): Promise<void> {
  await recordAdminActions(env, [entry]);
}

const AUDIT_ROWS_PER_INSERT = 14;

export async function recordAdminActions(env: Env, entries: AdminActionEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = drizzle(env.DB, { schema });
  const now = Date.now();
  const rows = entries.map((entry) => ({
    id: uid(),
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    detail: entry.detail ? JSON.stringify(entry.detail) : null,
    createdAt: now,
  }));
  const inserts = [];
  for (let i = 0; i < rows.length; i += AUDIT_ROWS_PER_INSERT)
    inserts.push(db.insert(schema.adminActions).values(rows.slice(i, i + AUDIT_ROWS_PER_INSERT)));
  const [first, ...rest] = inserts;
  try {
    if (first) await db.batch([first, ...rest]);
  } catch (error) {
    // The failure is alerted, with enough to write the entry back by hand.
    captureAlert(
      entries.map((entry) => ({
        level: "error",
        event: "admin_audit_write_failed",
        action: entry.action,
        actor_user_id: entry.actorUserId,
        target_type: entry.targetType,
        target_id: entry.targetId,
        detail: entry.detail ?? null,
        error: String(error),
      })),
    );
  }
}
