import { useRef, useState, type FormEvent } from "react";
import { INVITABLE_ROLES, type InvitableRole, type UserOrg } from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import { Link } from "@/app/ui/icons";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { MenuSelect } from "../ui/menu";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { EmailChips } from "./email-chips";
import { isEmail, splitEmails } from "../lib/members-data";

export const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer" },
  { value: "member", label: "Member" },
  { value: "admin", label: "Admin" },
];

/** What each role can do, said once, where the role is chosen. Without it
 * "viewer" and "member" look like the same word twice. */
const ROLE_HINT = {
  viewer: "Viewers see links and analytics, and change nothing.",
  member: "Members create and edit links and see analytics.",
  admin: "Admins manage links, domains and members.",
} satisfies Record<InvitableRole, string>;

export type EmailInvites = { emails: string[]; role: InvitableRole };

/** "Send invite", or "Send 3 invites" once there is more than one. */
function sendLabel(count: number): string {
  return count > 1 ? `Send ${count} invites` : "Send invite";
}

/** Why the addresses cannot go yet, or undefined when they can. Short, for
 * the label row. */
function emailsError(emails: string[], seatsLeft: number, limited: boolean): string | undefined {
  if (emails.length === 0) return "Add an email";
  const bad = emails.filter((e) => !isEmail(e));
  if (bad.length === 1) return `Not an email: ${bad[0]}`;
  if (bad.length > 1) return `${bad.length} are not emails`;
  if (limited && emails.length > seatsLeft)
    return seatsLeft === 1 ? "Only 1 seat free" : `Only ${seatsLeft} seats free`;
  return undefined;
}

/** "2 of 18 free seats on your plan." while addresses are in the box. */
function seatsLine(count: number, left: number): string {
  if (count === 0)
    return left === 1 ? "1 free seat on your plan." : `${left} free seats on your plan.`;
  return `${count} of ${left} free ${left === 1 ? "seat" : "seats"} on your plan.`;
}

/** "Invite people": any number of addresses at once, or a single-use link
 * for the same role. Opened from the Members header, never parked on the
 * page. */
export function InvitePeopleDialog({
  open,
  onOpenChange,
  org,
  seats,
  sendEmailInvites,
  createInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: UserOrg;
  seats: { limit: number; left: number };
  sendEmailInvites: {
    mutate: (params: EmailInvites, opts?: { onSuccess?: () => void }) => void;
    isPending: boolean;
  };
  createInvite: { mutate: (role: InvitableRole) => void; isPending: boolean };
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [error, setError] = useState<string | undefined>();
  // No limit to explain on a self-hosted instance.
  const limited = org.plan !== "unlimited";
  const all = [...emails, ...splitEmails(draft)];

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setEmails([]);
      setDraft("");
      setError(undefined);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (sendEmailInvites.isPending) return;
    const reason = emailsError(all, seats.left, limited);
    setEmails(all);
    setDraft("");
    setError(reason);
    if (reason) {
      input.current?.focus();
      return;
    }
    sendEmailInvites.mutate(
      { emails: all, role },
      {
        onSuccess: () => {
          toast(all.length > 1 ? `${all.length} invites sent` : "Invite sent");
          close(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close} title="Invite people" size="lg">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <EmailChips
          ref={input}
          label="Emails"
          emails={emails}
          onChange={(next) => {
            setEmails(next);
            setError(undefined);
          }}
          draft={draft}
          onDraftChange={(next) => {
            setDraft(next);
            setError(undefined);
          }}
          error={error}
          placeholder="teammate@company.com"
        />
        <div className="grid items-center gap-x-4 gap-y-1.5 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-xs text-muted">Role</span>
            <MenuSelect
              label="Role"
              value={role}
              onChange={(next) => setRole(oneOf(INVITABLE_ROLES, next, "member"))}
              options={ROLE_OPTIONS}
            />
          </div>
          <p className="text-xs text-pretty text-muted sm:pt-5">{ROLE_HINT[role]}</p>
        </div>
        {limited && <p className="text-xs text-muted tnum">{seatsLine(all.length, seats.left)}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            className="mr-auto pl-2.5"
            disabled={createInvite.isPending}
            onClick={() => createInvite.mutate(role)}
            title="Makes a single-use link, valid 7 days, and copies it"
          >
            <BusyContent busy={createInvite.isPending}>
              <span className="inline-flex items-center gap-1.5">
                <Link size={15} aria-hidden /> Copy invite link
              </span>
            </BusyContent>
          </Button>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={sendEmailInvites.isPending}>
            <BusyContent busy={sendEmailInvites.isPending}>{sendLabel(all.length)}</BusyContent>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
