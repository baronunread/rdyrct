import { formatNumber } from "../lib/numbers";

/** What every tooltip says: what the point is (a day, an hour, a country)
 * over how many clicks it had. Two lines, so the count reads as the answer.
 * The card is drawn here, not through pointerTooltip.className: with a custom
 * body the renderer pins its wrapper to an inline transparent, borderless,
 * unpadded style that no class can beat. */
export function ClicksTip({ label, clicks }: { label: string; clicks: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 whitespace-nowrap shadow-lg">
      <div className="text-xs text-muted">{label}</div>
      <div className="tnum text-sm font-semibold">
        {formatNumber(clicks)}{" "}
        <span className="text-xs font-normal text-muted">{clicks === 1 ? "click" : "clicks"}</span>
      </div>
    </div>
  );
}
