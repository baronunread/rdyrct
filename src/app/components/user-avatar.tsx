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

export function UserAvatar({
  user,
  size = 32,
  className,
}: {
  user: AvatarUser;
  size?: number;
  className?: string;
}) {
  const src = user.image ?? blobatarDataUri(user);
  return (
    <img
      src={src}
      alt={user.name || user.email || "avatar"}
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full object-cover", className)}
    />
  );
}
