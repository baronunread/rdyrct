import { useState } from "react";
import { blobatar } from "blobatar";
import { cn } from "@/app/ui/cn";

type AvatarUser = {
  id: string;
  image: string | null;
  name?: string;
  email?: string;
};

/** Deterministic blobatar (blobatar.dev) for users with no uploaded image.
 * Seeded on the display name (then email, then id), so it tracks a rename:
 * the settings form previews this live as you type. */
function blobatarDataUri(user: AvatarUser): string {
  const seed = user.name?.trim() || user.email?.trim() || user.id;
  const svg = blobatar(seed, { title: seed });
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The picture, unless it is the one that just failed to load; otherwise
 * the generated face. */
function avatarSrc(user: AvatarUser, failed: string | null): string {
  return user.image && user.image !== failed ? user.image : blobatarDataUri(user);
}

export function UserAvatar({
  user,
  size = 32,
  className,
}: {
  user: AvatarUser;
  size?: number;
  className?: string;
}) {
  // A picture that fails to load (removed since the list was fetched, or R2
  // busy) falls back to the generated face rather than a broken image.
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <img
      src={avatarSrc(user, failed)}
      onError={() => setFailed(user.image)}
      alt={user.name || user.email || "avatar"}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full object-cover image-outline", className)}
    />
  );
}
