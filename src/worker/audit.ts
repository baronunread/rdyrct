/**
 * The admin audit log (#67).
 *
 * One row per privileged mutation, appended and never updated. Small on
 * purpose: #22 covers the larger admin identity work (immutable root id,
 * roles, MFA) and should build on this table rather than adding a second one.
 *
 * Writing is best-effort and never blocks the action. That is the right way
 * round for this table: an admin stopping a phishing link at 2am must not be
 * refused because a log insert failed, and a missing entry is a smaller
 * problem than a live malware redirect. Failures are logged loudly so the gap
 * is visible.
 */
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import type { Env } from "./env";
import { uid } from "./util";

export type AdminAction =
  | "link.suspend"
  | "link.unsuspend"
  | "link.delete"
  | "org.suspend_links"
  | "org.unsuspend_links"
  | "org.delete"
  | "user.ban"
  | "user.unban"
  | "user.delete"
  | "user.comp_grant"
  | "user.comp_revoke"
  | "anon_link.delete";

export async function recordAdminAction(
  env: Env,
  entry: {
    actorUserId: string;
    action: AdminAction;
    targetType: "link" | "org" | "user" | "anon_link";
    targetId: string;
    /** Anything needed to read this entry once its target is gone. */
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await drizzle(env.DB, { schema })
      .insert(schema.adminActions)
      .values({
        id: uid(),
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        detail: entry.detail ? JSON.stringify(entry.detail) : null,
        createdAt: Date.now(),
      });
  } catch (error) {
    console.error("admin_audit_write_failed", entry.action, entry.targetId, error);
  }
}
