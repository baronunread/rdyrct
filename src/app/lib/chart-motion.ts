import type { ChartMotionOptions } from "@tanstack/charts/motion";

/**
 * How every chart moves. It draws at once when it appears: the charts sit
 * behind tabs people flip through, and the library's default (1.1s, a slow
 * start, bar by bar) left empty axes on screen each time. A new range still
 * morphs, quickly.
 */
export const chartMotion: ChartMotionOptions = {
  initial: false,
  transition: { type: "tween", duration: 200, easing: "ease-out" },
};
