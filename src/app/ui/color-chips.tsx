import type { ReactNode } from "react";
import { cn } from "./cn";
import { toHex6 } from "../lib/qr-contrast";

// A checkerboard for a colour that lets what is behind it through.
const CHECKER =
  "[background-image:conic-gradient(from_90deg,var(--border)_90deg,var(--surface)_0_180deg,var(--border)_0_270deg,var(--surface)_0)] [background-size:10px_10px]";

/**
 * One colour as a chip: the swatch, what it colours, and its hex. The whole
 * chip is the native picker's label, so a click anywhere on it opens the
 * picker.
 *
 * The swatch keeps a 7px radius rather than nesting strictly (10 - 6 = 4),
 * which reads as a square at 28px.
 */
export function ColorChip({
  label,
  value,
  onChange,
  disabled,
  transparent,
  className,
}: {
  label: string;
  /** Any hex; shown as "#rrggbb". */
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  /** Draw the swatch as see-through and say "None" instead of a hex. */
  transparent?: boolean;
  className?: string;
}) {
  const hex = toHex6(value);
  return (
    <div
      className={cn(
        "flex h-10 min-w-0 items-center rounded-[10px] bg-bg py-1.5 pr-2.5 pl-1.5 transition-[box-shadow] duration-150 has-[input[type=color]:focus-visible]:shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_color-mix(in_oklab,var(--accent)_25%,transparent)] has-[:disabled]:opacity-60",
        className,
      )}
    >
      <label
        title={label}
        className="flex min-w-0 cursor-pointer items-center gap-2 has-[:disabled]:cursor-default max-sm:gap-1.5"
      >
        <span className="relative size-7 shrink-0 max-sm:size-6">
          <input
            type="color"
            value={hex}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} colour`}
            className="absolute inset-0 size-full cursor-pointer appearance-none rounded-[7px] border-0 bg-transparent p-0 outline-none disabled:cursor-default [&::-moz-color-swatch]:rounded-[7px] [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-[7px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
          />
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[7px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_18%,transparent)]",
              transparent && CHECKER,
            )}
          />
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs text-muted">{label}</span>
          <span className="truncate font-mono text-xs">{transparent ? "None" : hex}</span>
        </span>
      </label>
    </div>
  );
}

/** Chips side by side. On a phone they stay on one line, tighter, and a
 * label truncates before a chip drops to a second line. */
export function ColorChips({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex max-w-full gap-2 max-sm:w-full max-sm:gap-1.5 [&>*]:max-sm:pr-2 [&>*]:max-sm:pl-1"
    >
      {children}
    </div>
  );
}
