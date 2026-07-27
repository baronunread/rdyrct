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

function TransparentToggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-1 text-2xs text-muted select-none">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="cursor-pointer accent-accent"
      />
      None
    </label>
  );
}

/**
 * One labeled color control (native swatch + optional transparent toggle) for
 * the QR editors. `value` is an override: "" shows `fallback` and means
 * inherit/default; picking a color or toggling transparent sets it. Shared by
 * the org QR defaults (Settings) and the per-link overrides (link editor).
 */
export function QrColorField({
  label,
  value,
  fallback,
  onChange,
  allowTransparent,
  disabled,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (value: string) => void;
  allowTransparent?: boolean;
  disabled?: boolean;
}) {
  const isTransparent = value === "transparent";
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <span className="truncate text-2xs tracking-wider text-muted uppercase">{label}</span>
        <ResetSwatchButton visible={!!value && !disabled} onReset={() => onChange("")} />
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={isTransparent ? "#ffffff" : value || fallback}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isTransparent}
          aria-label={label}
          className="h-9 w-full min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-bg p-1 disabled:cursor-default disabled:opacity-50"
        />
        {allowTransparent && (
          <TransparentToggle
            checked={isTransparent}
            disabled={disabled}
            onChange={(checked) => onChange(checked ? "transparent" : "")}
          />
        )}
      </div>
    </div>
  );
}
