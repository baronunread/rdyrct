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
import { alertBetterStack } from "./alerts";
import { uid } from "./util";

export type AdminAction =
  | "link.suspend"
  | "link.unsuspend"
  | "link.delete"
  | "link.rescore"
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
    // The mutation still stands. An admin stopping a phishing link at 2am
    // must not be refused because a log insert failed, and that is the whole
    // reason this is best-effort.
    //
    // But a moderation record that goes missing quietly is the kind of thing
    // discovered months later by whoever is answering for the decision, so
    // the failure is alerted rather than left in a log nobody reads, and it
    // carries enough to write the entry back by hand.
    console.error("admin_audit_write_failed", entry.action, entry.targetId, error);
    await alertBetterStack(env, [
      {
        level: "error",
        event: "admin_audit_write_failed",
        action: entry.action,
        actor_user_id: entry.actorUserId,
        target_type: entry.targetType,
        target_id: entry.targetId,
        detail: entry.detail ?? null,
        error: String(error),
      },
    ]);
  }
}
