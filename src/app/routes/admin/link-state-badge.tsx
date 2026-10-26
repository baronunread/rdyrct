import { Badge } from "../../ui/misc";
import { Tooltip } from "../../ui/tooltip";
import { cn } from "../../ui/cn";
import { linkState, linkStateDetail, type LinkState, type StateInput } from "./link-state";

/** Danger for what stops or condemns a link, butter for caution, muted for
 * nothing to do. The word always rides with the dot. */
const STYLE = {
  blocked: { color: "pink", dot: "bg-danger" },
  suspended: { color: "pink", dot: "bg-danger" },
  warning: { color: "butter", dot: "bg-butter" },
  risky: { color: "butter", dot: "bg-butter" },
  clean: { color: "muted", dot: "bg-muted" },
  unscored: { color: "muted", dot: "bg-muted" },
} as const satisfies Record<LinkState, { color: string; dot: string }>;

/** The row's worst state as a badge. A button so a keyboard can reach its
 * tooltip; its accessible name is the detail, for a screen reader that
 * skips tooltips (the detail opens with the state: "Suspended: …"). */
export function LinkStateBadge({ link }: { link: StateInput }) {
  const state = linkState(link);
  const detail = linkStateDetail(link);
  const { color, dot } = STYLE[state];
  return (
    <Tooltip content={detail}>
      <button
        type="button"
        aria-label={detail}
        className="cursor-default rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Badge color={color} className="gap-1.5">
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot)} />
          {state}
        </Badge>
      </button>
    </Tooltip>
  );
}
