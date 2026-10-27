import { cn } from "./cn";

/** A row of mutually exclusive choices: a section switch, or a filter. */
export function Segmented<Id extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly { id: Id; label: string }[];
  value: Id;
  onChange: (id: Id) => void;
  /** Names the group, so a control inside it can be told from a same-named
   * one elsewhere (the Reports view and the Reports column, say). */
  label?: string;
}) {
  return (
    // Radii nest: a 9px track, 2px of padding, 7px segments.
    <div
      role="group"
      aria-label={label}
      className="flex w-fit gap-0.5 rounded-[9px] bg-surface-2 p-0.5"
    >
      {items.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={cn(
            "h-7 cursor-pointer rounded-[7px] px-2.5 text-xs transition-colors",
            value === id
              ? "bg-surface font-semibold text-text smooth-shadow-ring-xs"
              : "text-muted [@media(hover:hover)]:hover:text-text",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
