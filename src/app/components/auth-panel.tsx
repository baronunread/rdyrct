import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { cn } from "../ui/cn";
import { Logo } from "../ui/logo";
import type { InvitePreview, OrgRole } from "@/shared/types";

/**
 * The sign-in, sign-up and code screens, as the redesign mock draws them:
 * one 380px card on the paper with the logo at its top, centred heading,
 * 16px between everything. On a phone the card drops its surface and
 * shadow and the screen is the card.
 */
export function AuthPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center px-3 py-10 sm:px-6 sm:py-20">
      <div
        className={cn(
          "flex w-full max-w-[380px] flex-col gap-4 sm:rounded-2xl sm:bg-surface sm:p-7 sm:smooth-shadow-ring-xl",
          className,
        )}
      >
        <Link to="/" aria-label="rdyrct home" className="self-center text-base">
          <Logo />
        </Link>
        {children}
      </div>
    </div>
  );
}

export function AuthHeading({ children }: { children: ReactNode }) {
  return <h1 className="text-center text-lg font-semibold text-balance">{children}</h1>;
}

/** A link in running auth copy: ink, with a quiet underline. */
export const AUTH_LINK =
  "cursor-pointer text-text underline decoration-border underline-offset-[3px] transition-[text-decoration-color] duration-150 [@media(hover:hover)]:hover:decoration-current";

/** The token of an invite `next` points at, if it does. */
function inviteTokenOf(next: string): string | null {
  const m = next.match(/^\/invite\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const ROLE_WITH_ARTICLE = {
  owner: "an owner",
  admin: "an admin",
  member: "a member",
  viewer: "a viewer",
} satisfies Record<OrgRole, string>;

/** An organization's initial on the accent: who you are about to join. */
function OrgInitial({ name, size = 28 }: { name: string; size?: 28 | 48 }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center bg-accent font-extrabold text-bg",
        size === 48 ? "size-12 rounded-[14px] text-xl" : "size-7 rounded-lg text-xs",
      )}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * On a sign-in or sign-up reached from an invite: what happens after it, so
 * the detour through a form does not read as losing the invite. Nothing
 * while the invite loads, and nothing for a dead one (the invite page says
 * that once they arrive).
 */
export function InviteBanner({ next }: { next: string }) {
  const token = inviteTokenOf(next);
  const preview = useQuery<InvitePreview>({
    // The same key the invite page reads, so it arrives already cached.
    queryKey: ["invite", token],
    queryFn: () => api(`/invites/${token}`),
    enabled: !!token,
    retry: false,
  });
  if (!token || !preview.data) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] bg-surface px-3 py-2.5 sm:bg-bg">
      <OrgInitial name={preview.data.orgName} />
      <p className="text-sm">
        Then you join <b className="font-semibold">{preview.data.orgName}</b> as{" "}
        {ROLE_WITH_ARTICLE[preview.data.role]}.
      </p>
    </div>
  );
}

const ROLE_SAYS = {
  owner: "Owners run the organization, its billing and its members.",
  admin: "Admins manage links, domains and members.",
  member: "Members create and edit links and see analytics.",
  viewer: "Viewers see links and analytics.",
} satisfies Record<OrgRole, string>;

/**
 * The mock's join screen (routes/invite.tsx): the org's initial, "Join
 * <org>", who invited you as what, then the page's own actions.
 */
export function InviteJoinCard({
  preview,
  inviter,
  actions,
}: {
  preview: InvitePreview;
  /** Who sent it, when the API says (it does not yet). */
  inviter?: string;
  actions: ReactNode;
}) {
  return (
    <AuthPanel className="text-center">
      <span className="self-center">
        <OrgInitial name={preview.orgName} size={48} />
      </span>
      <AuthHeading>Join {preview.orgName}</AuthHeading>
      <p className="text-sm text-pretty text-muted">
        {inviter ? `${inviter} invited you` : "You are invited"} as{" "}
        {ROLE_WITH_ARTICLE[preview.role].split(" ")[0]}{" "}
        <b className="font-semibold text-text">{preview.role}</b>. {ROLE_SAYS[preview.role]}
      </p>
      {actions}
    </AuthPanel>
  );
}
