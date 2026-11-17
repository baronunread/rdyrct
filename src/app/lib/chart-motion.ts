import type { ChartMotionOptions } from "@tanstack/charts/motion";

// Charts draw at once: they sit behind tabs people flip through, and the library's
// default (1.1s, slow start, bar by bar) left empty axes on screen each time.
export const chartMotion: ChartMotionOptions = {
  initial: false,
  transition: { type: "tween", duration: 200, easing: "ease-out" },
};
