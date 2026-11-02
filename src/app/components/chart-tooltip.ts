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

/** Room the tooltip card takes above its anchor: its height (two lines)
 * plus pointerTooltip's offset, with a little to spare. */
const ROOM_ABOVE = 64;

/** The pointer, held low enough under the plot's top that the card always
 * fits above it. */
function abovePointer(
  points: readonly ChartPoint[],
  context: ChartTooltipAnchorContext,
): { x: number; y: number } | null {
  const at = context.pointer ?? points[0];
  if (!at) return null;
  return { x: at.x, y: Math.max(at.y, context.plot.y + ROOM_ABOVE) };
}

/**
 * The tooltip for a chart read left to right (clicks by day, by hour): up
 * and to the right of the cursor, following it on both axes, and to the left
 * only near the right edge. It never flips from below the cursor to above it
 * (crossing the middle of the plot used to jump it about 67px): near the top
 * it stops and waits there instead.
 */
export const seriesTooltip = {
  ...pointerTooltip,
  anchor: abovePointer,
  placement: ["top-right", "top-left"],
} as const;
