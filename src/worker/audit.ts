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
  /** Anything needed to read this entry once its target is gone. */
  detail?: Record<string, JsonValue>;
}

export async function recordAdminAction(env: Env, entry: AdminActionEntry): Promise<void> {
  await recordAdminActions(env, [entry]);
}

/** Seven columns a row against D1's 100 bound parameters a statement. */
const AUDIT_ROWS_PER_INSERT = 14;

/**
 * Several entries in one D1 round trip, for a bulk action (#14): one insert
 * per entry was a subrequest per link. Best-effort like the single write.
 */
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
    // entries is not empty, so neither is inserts: `first` is always there.
    if (first) await db.batch([first, ...rest]);
  } catch (error) {
    // The mutation still stands. An admin stopping a phishing link at 2am
    // must not be refused because a log insert failed, and that is the whole
    // reason this is best-effort.
    //
    // But a moderation record that goes missing quietly is the kind of thing
    // discovered months later by whoever is answering for the decision, so
    // the failure is alerted rather than left in a log nobody reads, and it
    // carries enough to write the entry back by hand.
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
