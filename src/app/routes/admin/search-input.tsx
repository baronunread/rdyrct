import { Search } from "@/app/ui/icons";
import { Input } from "../../ui/field";
import { cn } from "../../ui/cn";

/** No margin of its own: in a toolbar row a bottom margin pushes the box up
 * out of line with the controls beside it. A page that stacks it over a table
 * spaces it with `className` or the gap of its container. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    // Full width on a phone, so its right edge meets the table card's; capped
    // from `sm` up, where a full-width box would be mostly empty.
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <Search
        size={14}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
      />
      <Input
        className="pl-8"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}
