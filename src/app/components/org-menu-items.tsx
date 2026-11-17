import { Check, Lock } from "@/app/ui/icons";
import { MenuItem } from "../ui/menu";
import { cn } from "../ui/cn";
import type { UserOrg } from "@/shared/types";

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
        {/* A locked org stays in the list and says so (#160). */}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate">{o.name}</span>
          {o.locked && <span className="text-xs text-muted">Read-only</span>}
        </span>
        {current && <Check size={15} className="shrink-0 text-accent" aria-label="Current" />}
      </MenuItem>
    );
  });
}
