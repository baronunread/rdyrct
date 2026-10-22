import { Check } from "@/app/ui/icons";
import { MenuItem } from "../ui/menu";
import type { UserOrg } from "@/shared/types";

/** One row per organization, the current one ticked, each with the role you
 *  hold in it. Shared by the app's switcher and the home page's card, so the
 *  two lists cannot drift apart. */
export function OrgMenuItems({
  orgs,
  currentId,
  onPick,
}: {
  orgs: UserOrg[];
  currentId: string | undefined;
  onPick: (id: string) => void;
}) {
  return orgs.map((o) => (
    <MenuItem key={o.id} onClick={() => onPick(o.id)}>
      <span className="w-4">
        {o.id === currentId && <Check size={13} className="text-accent" />}
      </span>
      <span className="truncate">{o.name}</span>
      {/* A locked org stays in the list and says so (#160). Hiding it is
          how somebody concludes their data is gone. */}
      <span className="ml-auto text-xs text-muted">{o.locked ? "locked" : o.role}</span>
    </MenuItem>
  ));
}
