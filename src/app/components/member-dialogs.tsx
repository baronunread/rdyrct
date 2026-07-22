import { type UseMutationResult } from "@tanstack/react-query";
import { Button } from "../ui/button";
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
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Remove member?">
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Remove <span className="font-medium">{member.name}</span> from
          this organization? They will lose access to all shared links and
          domains.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate(member.userId, {
                onSuccess: () => onClose(),
              });
            }}
          >
            <BusyContent busy={remove.isPending}>Remove</BusyContent>
          </Button>
        </div>
      </div>
    </Dialog>
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
          Creates a single-use invite link (valid 7 days). It is copied to
          your clipboard so you can share it any way you like.
        </p>
        <Field label="Role">
          <Select
            value={role}
            onChange={(e) => onRoleChange(e.target.value as "member" | "admin")}
          >
            <option value="member">member · manage links</option>
            <option value="admin">admin · manage links and team</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={isCreating}
            onClick={onCreate}
          >
            Create invite link
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
