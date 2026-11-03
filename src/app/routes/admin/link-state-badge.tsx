import { Tooltip } from "../../ui/tooltip";
import { StateLabel, type StateTone } from "./admin-kit";
import {
  linkState,
  linkStateDetail,
  linkStateWord,
  type LinkState,
  type StateInput,
} from "./link-state";

/** Danger for what stops or condemns a link, butter for caution, mint for a
 * checked link, muted for one nobody has looked at. The word always rides
 * with the dot. */
const TONE = {
  blocked: "bad",
  suspended: "bad",
  reported: "warn",
  warning: "warn",
  risky: "warn",
  clean: "ok",
  unscored: "quiet",
} as const satisfies Record<LinkState, StateTone>;

/** The row's worst state, as a dot and a word. A button so a keyboard can
 * reach its tooltip; its accessible name is the detail, for a screen reader
 * that skips tooltips (the detail opens with the state: "Suspended: …"). */
export function LinkStateBadge({ link }: { link: StateInput }) {
  const state = linkState(link);
  const detail = linkStateDetail(link);
  return (
    <Tooltip content={detail}>
      <button
        type="button"
        aria-label={detail}
        className="cursor-default rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <StateLabel tone={TONE[state]}>{linkStateWord(link)}</StateLabel>
      </button>
    </Tooltip>
  );
}
