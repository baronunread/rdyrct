import { cn } from "@/app/ui/cn";

type AvatarUser = {
  id: string;
  image: string | null;
  name?: string;
  email?: string;
};

/** Deterministic blobatar for users with no uploaded image: the same person
 * always gets the same colours and shape, derived from their id. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initials(user: AvatarUser): string {
  const source = user.name?.trim() || user.email?.trim() || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function Blobatar({ user, size }: { user: AvatarUser; size: number }) {
  const h = hash(user.id);
  const hue = h % 360;
  const hue2 = (hue + 40 + ((h >> 8) % 80)) % 360;
  const angle = h % 360;
  const letter = initials(user);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={user.name || user.email || "avatar"}
      className="shrink-0 rounded-full"
    >
      <defs>
        <linearGradient id={`bg-${user.id}`} gradientTransform={`rotate(${angle} 0.5 0.5)`}>
          <stop offset="0%" stopColor={`hsl(${hue} 70% 55%)`} />
          <stop offset="100%" stopColor={`hsl(${hue2} 70% 45%)`} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#bg-${user.id})`} />
      <text
        x="50"
        y="50"
        dy="0.35em"
        textAnchor="middle"
        fontSize="42"
        fontWeight="600"
        fill="white"
        fillOpacity="0.92"
        fontFamily="JetBrains Mono, monospace"
      >
        {letter}
      </text>
    </svg>
  );
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
  if (user.image)
    return (
      <img
        src={user.image}
        alt={user.name || user.email || "avatar"}
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  return <Blobatar user={user} size={size} />;
}
