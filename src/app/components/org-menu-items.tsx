import { Check, Lock } from "@/app/ui/icons";
import { MenuItem } from "../ui/menu";
import { cn } from "../ui/cn";
import type { UserOrg } from "@/shared/types";

/** An organization's initial on a small tile: the accent for the one you
 * are in, paper for the rest, and a lock for a read-only one, current or
 * not, since that is the thing to know about it. */
function OrgTile({
  org,
  current,
  className,
}: {
  org: UserOrg;
  current: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-extrabold",
        current && !org.locked ? "bg-accent text-bg" : "bg-surface-2 text-text",
        org.locked && "text-muted",
        className,
      )}
    >
      {org.locked ? <Lock size={11} /> : org.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** One row per organization: its tile, its name, a tick on the current one.
 *  Shared by the app's switcher and the home page's card, so the two lists
 *  cannot drift apart. */
export function OrgMenuItems({
  orgs,
  currentId,
  onPick,
}: {
  orgs: UserOrg[];
  currentId: string | undefined;
  onPick: (id: string) => void;
}) {
  return orgs.map((o) => {
    const current = o.id === currentId;
    return (
      <MenuItem key={o.id} onClick={() => onPick(o.id)}>
        <OrgTile org={o} current={current} />
        {/* A locked org stays in the list and says so (#160). Hiding it is
            how somebody concludes their data is gone. */}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate">{o.name}</span>
          {o.locked && <span className="text-xs text-muted">Read-only</span>}
        </span>
        {current && <Check size={15} className="shrink-0 text-accent" aria-label="Current" />}
      </MenuItem>
    );
  });
}
