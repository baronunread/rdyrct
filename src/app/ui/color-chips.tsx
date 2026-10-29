import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { cn } from "./cn";
import { toHex6 } from "../lib/qr-contrast";

// A checkerboard for a colour that lets what is behind it through.
const CHECKER =
  "[background-image:conic-gradient(from_90deg,var(--border)_90deg,var(--surface)_0_180deg,var(--border)_0_270deg,var(--surface)_0)] [background-size:10px_10px]";

/** Quick picks under the picker: black and white for contrast, then colours
 * dark enough to scan on white. */
const PRESETS = [
  "#000000",
  "#ffffff",
  "#17151f",
  "#4b2f8f",
  "#1f4fd1",
  "#0f7a55",
  "#b4231f",
  "#c2410c",
] as const;

/**
 * One colour as a chip: the swatch, what it colours, and its hex. Pressing
 * the chip opens a picker in a popover: a saturation square, a hue strip,
 * quick picks and a hex field to paste a brand colour into.
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
    <Popover.Root>
      <Popover.Trigger
        disabled={disabled}
        aria-label={`${label} colour, ${transparent ? "none" : hex}`}
        className={cn(
          "flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-[10px] bg-bg py-1.5 pr-2.5 pl-1.5 text-start transition-[box-shadow] duration-150 outline-none focus-visible:shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_color-mix(in_oklab,var(--accent)_25%,transparent)] disabled:cursor-default disabled:opacity-60 data-[popup-open]:shadow-[0_0_0_1.5px_var(--accent)] max-sm:gap-1.5",
          className,
        )}
      >
        <Swatch color={hex} transparent={transparent} className="size-7 max-sm:size-6" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs text-muted">{label}</span>
          <span className="truncate font-mono text-xs">{transparent ? "None" : hex}</span>
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start" className="z-50">
          <Popover.Popup
            aria-label={`${label} colour`}
            // fallow-ignore-next-line css-token-drift
            className="rdyrct-color-picker w-[232px] origin-[var(--transform-origin)] rounded-xl bg-surface p-3 smooth-shadow-ring-xl transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
          >
            <HexColorPicker color={hex} onChange={onChange} />
            <div role="group" aria-label="Quick colours" className="mt-3 grid grid-cols-8 gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-label={preset}
                  aria-pressed={preset === hex}
                  onClick={() => onChange(preset)}
                  className="group grid aspect-square cursor-pointer place-items-center rounded-[6px] outline-none focus-visible:shadow-[0_0_0_1.5px_var(--accent)] aria-pressed:shadow-[0_0_0_1.5px_var(--text)]"
                >
                  <Swatch
                    color={preset}
                    className="size-full transition-[scale] duration-150 ease-out group-active:scale-90"
                  />
                </button>
              ))}
            </div>
            <label className="mt-3 flex h-9 items-center gap-2 rounded-lg bg-bg px-2.5 smooth-shadow-ring-xs focus-within:shadow-[0_0_0_1.5px_var(--accent)]">
              <span className="text-xs text-muted">Hex</span>
              <HexColorInput
                prefixed
                color={hex}
                onChange={onChange}
                aria-label={`${label} colour, hex`}
                className="min-w-0 flex-1 bg-transparent text-end font-mono text-xs text-text uppercase outline-none"
              />
            </label>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Swatch({
  color,
  transparent,
  className,
}: {
  color: string;
  transparent?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={transparent ? undefined : { backgroundColor: color }}
      className={cn(
        "block shrink-0 rounded-[7px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--text)_18%,transparent)]",
        transparent && CHECKER,
        className,
      )}
    />
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
