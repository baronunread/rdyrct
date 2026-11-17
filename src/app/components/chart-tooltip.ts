import { tooltip } from "@tanstack/charts/tooltip";
import type { ChartPoint, ChartTooltipAnchorContext } from "@tanstack/charts";

/**
 * A tooltip anchored to the pointer repaints on every move, so this spring is a
 * short catch-up each frame. The renderer's default tween reads as drag.
 */
const followSpring = { type: "spring", stiffness: 170, damping: 22, mass: 1 } as const;

/** Lives here, not in charts.tsx, because country-map.tsx needs it and charts.tsx imports that. */
export const pointerTooltip = {
  use: tooltip,
  anchor: "pointer",
  placement: "auto",
  offset: 16,
  motion: followSpring,
  className: "pointer-events-none",
} as const;

const ROOM_ABOVE = 64;

function abovePointer(
  points: readonly ChartPoint[],
  context: ChartTooltipAnchorContext,
): { x: number; y: number } | null {
  const at = context.pointer ?? points[0];
  if (!at) return null;
  return { x: at.x, y: Math.max(at.y, context.plot.y + ROOM_ABOVE) };
}

/**
 * Never flips from below the cursor to above it (crossing the plot's middle
 * jumped it about 67px): near the top it stops and waits there.
 */
export const seriesTooltip = {
  ...pointerTooltip,
  anchor: abovePointer,
  placement: ["top-right", "top-left"],
} as const;
