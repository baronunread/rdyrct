import { cn } from "./cn";

/** A row of mutually exclusive choices: a section switch, or a filter. */
export function Segmented<Id extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly { id: Id; label: string }[];
  value: Id;
  onChange: (id: Id) => void;
}) {
  return (
    <div className="flex w-fit gap-1 rounded-lg bg-surface-2 p-1">
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
