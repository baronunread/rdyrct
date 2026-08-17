import { tooltip } from "@tanstack/charts/tooltip";

/**
 * What every chart's tooltip eases with. A tooltip anchored to the pointer is
 * repainted on every pointer move (the renderer forces a repaint while the
 * anchor tracks the pointer, even when the focused point has not changed), so
 * this spring is a short catch-up each frame and reads as following the
 * cursor. Left unset, a chart falls back to the renderer's default tween,
 * which is slow enough to read as drag.
 */
export const followSpring = { type: "spring", stiffness: 170, damping: 22, mass: 1 } as const;

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
  className:
    "pointer-events-none rounded-md bg-surface-2 px-2.5 py-1.5 text-xs whitespace-nowrap smooth-shadow-ring-lg",
} as const;
