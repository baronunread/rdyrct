import { IconLock } from "@tabler/icons-react";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";

/** One choice. A locked one is shown, with a lock, but not chosen: the
 * control says what the plan hides instead of hiding it. */
export interface SegmentedItem<Id extends string> {
  id: Id;
  label: string;
  locked?: boolean;
  /** Why it is locked, in a tooltip. */
  hint?: string;
}

/** A row of mutually exclusive choices: a section switch, or a filter. */
export function Segmented<Id extends string>({
  items,
  value,
  onChange,
  onLocked,
  label,
}: {
  items: readonly SegmentedItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  /** What a locked choice does when pressed (open the plans, say). */
  onLocked?: (id: Id) => void;
  /** Names the group, so a control inside it can be told from a same-named
   * one elsewhere (the Reports view and the Reports column, say). */
  label?: string;
}) {
  return (
    // Radii nest: a 9px track, 2px of padding, 7px segments.
    <div
      role="group"
      aria-label={label}
      className="flex w-fit shrink-0 gap-0.5 rounded-[9px] bg-surface-2 p-0.5"
    >
      {items.map((item) => {
        const button = (
          <button
            key={item.id}
            type="button"
            onClick={() => (item.locked ? onLocked?.(item.id) : onChange(item.id))}
            aria-pressed={item.locked ? undefined : value === item.id}
            aria-disabled={item.locked || undefined}
            className={cn(
              "inline-flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-xs transition-[color,background-color,box-shadow] duration-150 ease-out max-sm:h-9 max-sm:px-3",
              !item.locked && value === item.id
                ? "bg-surface font-semibold text-text smooth-shadow-ring-xs"
                : "text-muted [@media(hover:hover)]:hover:text-text",
            )}
          >
            {item.locked && <IconLock aria-hidden size={11} stroke={2} />}
            {item.label}
          </button>
        );
        return item.locked && item.hint ? (
          <Tooltip key={item.id} content={item.hint}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
