/**
 * The small pictures in a links row: the letter tile beside the destination
 * and the 7-day sparkline, both drawn from data the row already has. The
 * CSP forbids remote images, so a site's favicon is a letter tile.
 */
import { cn } from "../ui/cn";

/** The site's first letter in a small tile, standing in for its favicon. */
export function SiteLetter({ host, className }: { host: string; className?: string }) {
  const letter =
    host
      .replace(/^www\./, "")
      .charAt(0)
      .toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-surface text-[10px] font-extrabold text-muted smooth-shadow-ring-xs",
        className,
      )}
    >
      {letter}
    </span>
  );
}

const W = 72;
const H = 24;

/** A monotone cubic through the points (never overshoots, so it never dips
 * below zero between two quiet days), as rdyrct-design asks of charts. */
function smoothPath(points: [number, number][]): string {
  const n = points.length;
  if (n < 2) return "";
  const dx = points.map((p, i) => (i < n - 1 ? points[i + 1][0] - p[0] : 0));
  const slope = points.map((p, i) => (i < n - 1 ? (points[i + 1][1] - p[1]) / dx[i] : 0));
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    if (slope[i - 1] * slope[i] <= 0) return 0;
    return (slope[i - 1] + slope[i]) / 2;
  });
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    d += ` C${(x0 + h).toFixed(1)},${(y0 + tangent[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - tangent[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/**
 * Fourteen days of clicks in 72 by 24. A dashed baseline when there were
 * none; dimmed when the link is quiet (under 20 in the fortnight) so the
 * busy ones stand out down the column. Decoration beside a number that says
 * the same thing, so hidden from assistive tech.
 */
export function Sparkline({ series }: { series: number[] }) {
  const total = series.reduce((a, b) => a + b, 0);
  if (total === 0)
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-6 w-[72px]" aria-hidden>
        <line
          x1="0"
          x2={W}
          y1={H - 2}
          y2={H - 2}
          className="stroke-placeholder"
          strokeWidth="1.5"
          strokeDasharray="2 3"
        />
      </svg>
    );
  const max = Math.max(...series);
  const points = series.map((v, i): [number, number] => [
    (i / (series.length - 1)) * W,
    H - 2 - (v / max) * (H - 4),
  ]);
  const line = smoothPath(points);
  const dim = total < 20;
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-6 w-[72px] overflow-visible" aria-hidden>
      <path
        d={`${line} L${W},${H} L0,${H} Z`}
        className={dim ? "fill-accent/[0.06]" : "fill-accent/[0.14]"}
      />
      <path
        d={line}
        fill="none"
        className={dim ? "stroke-placeholder" : "stroke-accent"}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle
        cx={W}
        cy={last[1].toFixed(1)}
        r="2"
        className={dim ? "fill-placeholder" : "fill-accent"}
      />
    </svg>
  );
}
