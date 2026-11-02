import { tooltip } from "@tanstack/charts/tooltip";
import type { ChartPoint, ChartTooltipAnchorContext } from "@tanstack/charts";

/**
 * What every chart's tooltip eases with. A tooltip anchored to the pointer is
 * repainted on every pointer move (the renderer forces a repaint while the
 * anchor tracks the pointer, even when the focused point has not changed), so
 * this spring is a short catch-up each frame and reads as following the
 * cursor. Left unset, a chart falls back to the renderer's default tween,
 * which is slow enough to read as drag.
 */
const followSpring = { type: "spring", stiffness: 170, damping: 22, mass: 1 } as const;

/**
 * The one tooltip every chart in the app uses: parked beside the pointer,
 * turned around near an edge rather than allowed to run off the card.
 *
 * It lives here rather than in charts.tsx because country-map.tsx needs it
 * too, and charts.tsx already imports that.
 */
export const pointerTooltip = {
  use: tooltip,
  anchor: "pointer",
  placement: "auto",
  offset: 16,
  motion: followSpring,
  className: "pointer-events-none",
} as const;

/** Beside the pointer across, at the hovered point's height. */
function besidePoint(
  points: readonly ChartPoint[],
  context: ChartTooltipAnchorContext,
): { x: number; y: number } | null {
  const point = points[0];
  if (!point) return null;
  return { x: context.pointer?.x ?? point.x, y: point.y };
}

/**
 * The tooltip for a chart read left to right (clicks by day, by hour): it
 * follows the pointer across, but sits at the hovered point's height (the
 * line, a bar's top) rather than the pointer's. Moving up and down changes
 * nothing, so it never flips from below the cursor to above it halfway down
 * the chart, which read as a jump. Above the point first, then beside it
 * when a peak leaves no room over it, so it never covers the bar it is
 * about; below only as a last resort.
 */
export const seriesTooltip = {
  ...pointerTooltip,
  anchor: besidePoint,
  placement: ["top", "top-right", "top-left", "right", "left", "bottom"],
} as const;
