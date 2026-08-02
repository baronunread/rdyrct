import { Popover } from "@base-ui/react/popover";
import { HexAlphaColorPicker, HexColorInput, HexColorPicker } from "react-colorful";
import { cn } from "../ui/cn";
import { hasTransparency } from "../lib/qr-look";

function ResetSwatchButton({ visible, onReset }: { visible: boolean; onReset: () => void }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onReset}
      className="shrink-0 cursor-pointer text-3xs tracking-wider text-muted uppercase hover:text-text"
    >
      Reset
    </button>
  );
}

/** Ensures a color is 8-digit hex (with alpha) for the alpha picker/swatch to
 * read: the legacy 'transparent' sentinel becomes fully transparent white, a
 * plain 6-digit hex (opaque, including anything the picker itself emits at
 * 100% alpha) gets an 'ff' suffix, and anything already 8-digit passes
 * through. */
function toHex8(color: string): string {
  if (color === "transparent") return "#ffffff00";
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return `${color}ff`;
  return "#ffffffff";
}

function ColorSwatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("relative block shrink-0 overflow-hidden rounded", className)}
      style={{
        backgroundImage: hasTransparency(color)
          ? "conic-gradient(from 90deg, rgba(128,128,128,.35) 90deg, transparent 0 180deg, rgba(128,128,128,.35) 0 270deg, transparent 0)"
          : undefined,
        backgroundSize: "8px 8px",
      }}
    >
      <span className="absolute inset-0" style={{ backgroundColor: color }} />
    </span>
  );
}

/**
 * One labeled color control for the QR editors: a swatch button opens a
 * popover with a saturation/hue picker (react-colorful) plus a typed hex
 * field. `value` is an override: "" shows `fallback` and means
 * inherit/default; picking a color sets it. Shared by the org QR defaults
 * (Settings) and the per-link overrides (link editor).
 *
 * `alpha` adds a transparency slider and switches storage to 8-digit hex
 * (dragging alpha to 0 *is* "none" — no separate checkbox). Only the QR
 * background supports this; dot/eye color stay opaque 6-digit hex, since a
 * transparent dot or eye would just break the scan.
 */
export function QrColorField({
  label,
  value,
  fallback,
  onChange,
  disabled,
  alpha = false,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  alpha?: boolean;
}) {
  const color = alpha ? toHex8(value || fallback) : value || fallback;
  const Picker = alpha ? HexAlphaColorPicker : HexColorPicker;
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="truncate text-2xs tracking-wider text-muted uppercase">{label}</span>
        <ResetSwatchButton visible={!!value && !disabled} onReset={() => onChange("")} />
      </div>
      <Popover.Root>
        <Popover.Trigger
          disabled={disabled}
          aria-label={label}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-bg px-2 text-sm transition-colors enabled:cursor-pointer enabled:hover:border-accent disabled:opacity-50"
        >
          <ColorSwatch color={color} className="h-6 w-6" />
          <span className="truncate text-muted uppercase">{color}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={6} align="start" className="z-50">
            <Popover.Popup className="rounded-lg border border-border bg-surface p-3 shadow-xl transition-[opacity,scale] duration-100 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              <Picker color={color} onChange={onChange} />
              <HexColorInput
                alpha={alpha}
                prefixed
                color={color}
                onChange={onChange}
                className="mt-2 h-8 w-full rounded-md border border-border bg-bg px-2 text-center text-xs text-text uppercase focus:border-accent focus:outline-none"
              />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
