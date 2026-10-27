import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { valibotResolver } from "@hookform/resolvers/valibot";
import { INVITABLE_ROLES, type InvitableRole, type UserOrg } from "@/shared/types";
import { oneOf } from "@/shared/lookup";
import { Info, Link } from "@/app/ui/icons";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Field, Input } from "../ui/field";
import { MenuSelect } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { BusyContent } from "../ui/spinner";
import { useToast } from "../ui/toast";
import { inviteEmailSchema } from "../lib/schemas";

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

type EmailInvite = { email: string; role: InvitableRole };

/** "Invite people": an email invite, or a single-use link for the same
 * role. Opened from the Members header, never parked on the page. */
export function InvitePeopleDialog({
  open,
  onOpenChange,
  org,
  seats,
  sendEmailInvite,
  createInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: UserOrg;
  seats: { limit: number; left: number };
  sendEmailInvite: {
    mutate: (params: EmailInvite, opts?: { onSuccess?: () => void }) => void;
    isPending: boolean;
  };
  createInvite: { mutate: (role: InvitableRole) => void; isPending: boolean };
}) {
  const toast = useToast();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<EmailInvite>({
    resolver: valibotResolver(inviteEmailSchema),
    defaultValues: { email: "", role: "member" },
  });
  const role = watch("role");

  const submit = useCallback(
    ({ email, role }: EmailInvite) => {
      sendEmailInvite.mutate(
        { email, role },
        {
          onSuccess: () => {
            reset({ email: "", role });
            toast("Invite sent");
            onOpenChange(false);
          },
        },
      );
    },
    [sendEmailInvite, reset, toast, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Invite people">
      <form onSubmit={handleSubmit(submit)} noValidate className="flex flex-col gap-4">
        <Field label="Email" error={errors.email ? "Enter a valid email" : undefined}>
          <Input
            type="email"
            autoComplete="off"
            autoFocus
            {...register("email")}
            placeholder="teammate@company.com"
          />
        </Field>
        <Field label="Role" hint={ROLE_HINT[role]}>
          <MenuSelect
            label="Role"
            value={role}
            onChange={(next) => setValue("role", oneOf(INVITABLE_ROLES, next, "member"))}
            options={ROLE_OPTIONS}
          />
        </Field>
        {/* No limit to explain on a self-hosted instance. */}
        {org.plan !== "unlimited" && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className="tnum">
              {seats.left} of {seats.limit} seats free on your plan
            </span>
            <Tooltip
              content={
                <>
                  You can invite up to {seats.limit} members on the {org.plan} plan. Pending invites
                  count toward the limit.
                </>
              }
            >
              <button
                type="button"
                aria-label="Member limit info"
                className="relative cursor-help text-muted after:absolute after:-inset-1.5 hover:text-text"
              >
                <Info size={13} />
              </button>
            </Tooltip>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            className="mr-auto"
            disabled={createInvite.isPending}
            onClick={() => createInvite.mutate(role)}
            title="Creates a single-use link, valid 7 days, and copies it"
          >
            <BusyContent busy={createInvite.isPending}>
              <span className="inline-flex items-center gap-1.5">
                <Link size={15} /> Create invite link
              </span>
            </BusyContent>
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={sendEmailInvite.isPending}>
            <BusyContent busy={sendEmailInvite.isPending}>Send invite</BusyContent>
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
