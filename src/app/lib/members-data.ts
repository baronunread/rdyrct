import type { InviteDTO, MemberDTO, OrgRole } from "@/shared/types";

/**
 * What the members page reads beyond today's `MemberDTO`: `image`, the
 * member's picture. The API does not send it yet, because a picture is
 * served only to its own account (`/api/user/avatar` answers with the
 * signed-in user's), so another member's needs a route of its own first.
 * Until then every member shows the generated face.
 */
export type MemberRowData = MemberDTO & {
  image?: string | null;
};

/** An invite, plus who sent it once the API says so. */
export type InviteRowData = InviteDTO & {
  invitedByName?: string | null;
};

export const ROLE_LABEL = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
} satisfies Record<OrgRole, string>;

const DAY_MS = 86_400_000;
const ONLINE_MS = 5 * 60_000;

const MONTH_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Online now", "Today", "Yesterday", "3 days ago", then "Oct 2". */
export function lastActiveLabel(ts: number | null, now = Date.now()): string {
  if (ts == null) return "Never";
  if (now - ts < ONLINE_MS) return "Online now";
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return MONTH_DAY.format(new Date(ts));
}

/** "Expires Nov 3". */
export function expiresLabel(ts: number): string {
  return `Expires ${MONTH_DAY.format(new Date(ts))}`;
}

/** Every address in a pasted or typed run: commas, semicolons, spaces and
 * new lines all separate them. */
export function splitEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(text: string): boolean {
  return EMAIL_RE.test(text);
}
