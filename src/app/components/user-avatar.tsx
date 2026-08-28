import { blobatar } from "blobatar";
import { cn } from "@/app/ui/cn";

type AvatarUser = {
  id: string;
  image: string | null;
  name?: string;
  email?: string;
};

/** Deterministic blobatar (blobatar.dev) for users with no uploaded image:
 * the same id always renders the same creature. Seeded on the id, not the
 * name, so a rename keeps the same face. */
function blobatarDataUri(user: AvatarUser): string {
  const svg = blobatar(user.id, { title: user.name || user.email || "avatar" });
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
