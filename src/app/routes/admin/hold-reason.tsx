/** Why a link or org is held, printed under its badge so a phone, which has
 * no hover, can read it too. Two lines at most; the title has the rest. */
export function HoldReason({ why }: { why: string | null }) {
  if (!why) return null;
  return (
    <span className="mt-1 line-clamp-2 text-xs break-words text-muted" title={why}>
      {why}
    </span>
  );
}
