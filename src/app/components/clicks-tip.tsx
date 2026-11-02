import { formatNumber } from "../lib/numbers";

/** What every tooltip says: what the point is (a day, an hour, a country)
 * and how many clicks it had. Bare text beside the pointer, no card: it
 * follows the cursor, and a box moving with it reads as a thing to look at
 * rather than a label on the point. */
export function ClicksTip({ label, clicks }: { label: string; clicks: number }) {
  return (
    <span className="text-xs whitespace-nowrap">
      <span className="text-muted">{label}</span>{" "}
      <span className="tnum font-semibold">{formatNumber(clicks)}</span>
    </span>
  );
}
