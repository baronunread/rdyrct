import { useState } from "react";
import type { User } from "@/shared/types";
import { Pencil } from "@/app/ui/icons";
import { UserAvatar } from "./user-avatar";
import { AvatarPictureDialog } from "./avatar-picture-dialog";
import { Tooltip } from "@/app/ui/tooltip";

export function AvatarInput({
  user,
  pendingUrl,
  pendingRemove,
  onPick,
  onRemove,
  size = 128,
}: {
  user: User;
  size?: number;
  pendingUrl?: string;
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
          size={size}
          className={size > 64 ? "border-2 border-border" : undefined}
        />
        <Tooltip content="Change picture">
          <button
            type="button"
            aria-label="Change picture"
            onClick={() => setOpen(true)}
            className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-bg/55 text-text opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
          >
            <Pencil size={size > 64 ? 22 : 14} />
          </button>
        </Tooltip>
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
