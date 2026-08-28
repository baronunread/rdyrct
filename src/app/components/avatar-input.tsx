import { useState } from "react";
import type { User } from "@/shared/types";
import { Pencil } from "@/app/ui/icons";
import { UserAvatar } from "./user-avatar";
import { AvatarPictureDialog } from "./avatar-picture-dialog";

/** The account form's picture control: a big avatar with a pencil overlay.
 * The pencil opens a dialog to upload/crop or remove. Nothing reaches the
 * server here; a chosen crop (or a removal) is handed up and applied on Save. */
export function AvatarInput({
  user,
  pendingUrl,
  pendingRemove,
  onPick,
  onRemove,
}: {
  user: User;
  /** Data URL of a not-yet-saved crop. */
  pendingUrl?: string;
  /** The saved picture is marked for deletion. */
  pendingRemove?: boolean;
  onPick: (blob: Blob) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shownImage = pendingUrl ?? (pendingRemove ? null : user.image);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="group relative">
        <UserAvatar
          user={{ ...user, image: shownImage }}
          size={128}
          className="border-2 border-border"
        />
        <button
          type="button"
          aria-label="Change picture"
          title="Change picture"
          onClick={() => setOpen(true)}
          className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-bg/55 text-text opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
        >
          <Pencil size={22} />
        </button>
      </div>

      {open && (
        <AvatarPictureDialog
          hasImage={Boolean(shownImage)}
          onClose={() => setOpen(false)}
          onApply={(blob) => {
            onPick(blob);
            setOpen(false);
          }}
          onRemove={onRemove}
        />
      )}
    </div>
  );
}
