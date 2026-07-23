import { type UseMutationResult } from "@tanstack/react-query";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Dialog } from "../ui/dialog";
import { Field, Select } from "../ui/field";
import { BusyContent } from "../ui/spinner";

export function RemoveMemberDialog({
  member,
  onClose,
  remove,
}: {
  member: { userId: string; name: string };
  onClose: () => void;
  remove: UseMutationResult<unknown, Error, string, unknown>;
}) {
  return (
    <ConfirmDialog
      title="Remove member?"
      open
      onClose={onClose}
      onConfirm={() => {
        remove.mutate(member.userId, {
          onSuccess: onClose,
        });
      }}
      confirmLabel="Remove"
      danger
      pending={remove.isPending}
    >
      Remove <span className="font-medium">{member.name}</span> from this organization? They will
      lose access to all shared links and domains.
    </ConfirmDialog>
  );
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  role,
  onRoleChange,
  onCreate,
  isCreating,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: "member" | "admin";
  onRoleChange: (role: "member" | "admin") => void;
  onCreate: () => void;
  isCreating: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Invite a teammate">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Creates a single-use invite link (valid 7 days). It is copied to your clipboard so you can
          share it any way you like.
        </p>
        <Field label="Role">
          <Select value={role} onChange={(e) => onRoleChange(e.target.value as "member" | "admin")}>
            <option value="member">member · manage links</option>
            <option value="admin">admin · manage links and team</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={isCreating} onClick={onCreate}>
            <BusyContent busy={isCreating}>Create invite link</BusyContent>
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
