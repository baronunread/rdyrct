import { Tooltip } from "../../ui/tooltip";
import { StateLabel, type StateTone } from "./admin-kit";
import {
  linkState,
  linkStateDetail,
  linkStateWord,
  type LinkState,
  type StateInput,
} from "./link-state";

const TONE = {
  blocked: "bad",
  suspended: "bad",
  reported: "warn",
  warning: "warn",
  risky: "warn",
  clean: "ok",
  unscored: "quiet",
} as const satisfies Record<LinkState, StateTone>;

/** Its accessible name is the detail, for a screen reader that skips tooltips. */
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
