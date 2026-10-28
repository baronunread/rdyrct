/**
 * The small pictures in a links row: the QR thumbnail beside the link, the
 * letter tile beside the destination, and the 14-day sparkline.
 *
 * All three are drawn here from data the row already has. The CSP forbids
 * remote images, so a site's favicon is a letter tile; and the thumbnail is
 * the link's real code at thumbnail size (plain modules, no styling), cheap
 * enough to draw for a page of rows without qr-code-styling.
 */
import { memo, useMemo } from "react";
import qrcode from "qrcode-generator";
import { IconLink } from "@tabler/icons-react";
import { cn } from "../ui/cn";

/** Every dark module of `url`'s code as one SVG path, plus its size. */
function qrPath(url: string) {
  // Type 0 picks the smallest version the URL fits; "L" keeps it small,
  // since a thumbnail is never scanned.
  const code = qrcode(0, "L");
  code.addData(url);
  code.make();
  const size = code.getModuleCount();
  let d = "";
  for (let row = 0; row < size; row++)
    for (let col = 0; col < size; col++) if (code.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
  return { d, size };
}

/**
 * The link's QR code at 28px (32px on a phone), or a link glyph in the same
 * box when the code is the org's default look. A thumbnail of every row
 * would make the column a wall of noise; the glyph keeps the column's shape
 * and says "plain link" without one.
 */
export const QrThumb = memo(function QrThumb({
  url,
  custom,
  className,
}: {
  url: string;
  custom: boolean;
  className?: string;
}) {
  const path = useMemo(() => (custom ? qrPath(url) : null), [url, custom]);
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md bg-surface p-[3px] text-muted smooth-shadow-ring-xs sm:size-7",
        className,
      )}
    >
      {path ? (
        <svg
          viewBox={`0 0 ${path.size} ${path.size}`}
          className="size-full [shape-rendering:crispEdges]"
        >
          <path d={path.d} className="fill-text" />
        </svg>
      ) : (
        <IconLink size={13} stroke={1.75} />
      )}
    </span>
  );
});

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
