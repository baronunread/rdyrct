import { useNavigate } from "@tanstack/react-router";
import { Segmented } from "../ui/segmented";
import { presetId, type RangePreset } from "../lib/insights-data";

/** Clicks are kept 400 days whatever the plan, so a locked range is hidden, not gone (#163). */
function lockedHint(preset: RangePreset): string {
  const plan = preset.days > 30 ? "Pro" : "A paid plan";
  return `${plan} shows the last ${preset.days} days. Clicks are kept for 400 days, so they are all there when you upgrade.`;
}

export function RangeControl({
  presets,
  maxDays,
  days,
  bucket,
  onChange,
}: {
  presets: readonly RangePreset[];
  maxDays: number;
  days: number;
  bucket: "day" | "hour";
  onChange: (preset: RangePreset) => void;
}) {
  const navigate = useNavigate();
  return (
    <Segmented
      label="Range"
      items={presets.map((p) => ({
        id: presetId(p),
        label: p.label,
        locked: p.days > maxDays,
        hint: p.days > maxDays ? lockedHint(p) : undefined,
      }))}
      value={presetId({ days, bucket })}
      onChange={(id) => {
        const p = presets.find((x) => presetId(x) === id);
        if (p) onChange(p);
      }}
      onLocked={() => void navigate({ to: "/billing" })}
    />
  );
}
