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
    <div role="group" aria-label={label} className="flex w-fit gap-1 rounded-lg bg-surface-2 p-1">
      {items.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "cursor-pointer rounded-md px-3 py-1.5 text-xs transition-colors",
            value === id
              ? "bg-surface font-bold text-text shadow-sm"
              : "text-muted hover:text-text",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
