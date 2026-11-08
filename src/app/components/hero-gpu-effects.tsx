/**
 * The canvases for lib/hero-gpu.ts. This module is only ever loaded lazily,
 * and only when `hasWebGpu()` (lib/webgpu.ts) said yes, so TypeGPU never
 * reaches a browser that cannot use it. Each canvas fades in once its first
 * frame is drawn, and stays transparent if the GPU refuses: decoration that
 * fails shows nothing, never an error.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../ui/cn";
import { startEdgeLight, startHeroBackdrop } from "../lib/hero-gpu";

/** Runs `start` against the canvas once mounted, and its stop on unmount. */
function useGpuEffect(
  start: (canvas: HTMLCanvasElement) => Promise<() => void> | null,
): [React.RefObject<HTMLCanvasElement | null>, boolean] {
  const ref = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    const started = canvas ? start(canvas) : null;
    if (!started) return;
    let stop: (() => void) | undefined;
    let unmounted = false;
    started
      .then((stopIt) => {
        if (unmounted) stopIt();
        else {
          stop = stopIt;
          setRunning(true);
        }
      })
      // A GPU that will not start leaves the canvas transparent.
      .catch(() => {});
    return () => {
      unmounted = true;
      stop?.();
    };
  }, [start]);
  return [ref, running];
}

function startBackdrop(canvas: HTMLCanvasElement) {
  const title = canvas.closest("[data-hero]")?.querySelector("h1");
  return title ? startHeroBackdrop(canvas, title) : null;
}

/** The wash of colour behind the hero, reaching up under the header and out
 *  to both edges of the window, past the page column. 100vw counts the
 *  scrollbar, so styles.css clips the page sideways (`[data-hero]`) rather
 *  than let it scroll. */
export function HeroBackdrop(): React.ReactElement | null {
  const [ref, running] = useGpuEffect(startBackdrop);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -top-16 left-1/2 -z-10 h-[calc(100%+4rem)] w-screen -translate-x-1/2 opacity-0 transition-opacity duration-1000 motion-reduce:transition-none",
        running && "opacity-100",
      )}
    />
  );
}

/** How far the edge light's canvas overhangs its frame, for the halo. */
const EDGE_INSET = 40;

export type EdgeLightProps = {
  frame: React.RefObject<HTMLElement | null>;
  radius: number;
};

/** The light along the screenshot frame's edge. Place it inside the frame's
 *  positioned parent; `frame` is the element whose edge it lights. */
export function EdgeLight({ frame, radius }: EdgeLightProps): React.ReactElement | null {
  const start = useCallback(
    (canvas: HTMLCanvasElement) =>
      frame.current ? startEdgeLight(canvas, frame.current, EDGE_INSET, radius) : null,
    [frame, radius],
  );
  const [ref, running] = useGpuEffect(start);
  // A canvas does not stretch between its insets the way a div does, so
  // its size is spelled out.
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        top: -EDGE_INSET,
        left: -EDGE_INSET,
        width: `calc(100% + ${EDGE_INSET * 2}px)`,
        height: `calc(100% + ${EDGE_INSET * 2}px)`,
      }}
      className={cn(
        "pointer-events-none absolute z-10 opacity-0 transition-opacity duration-700 motion-reduce:transition-none",
        running && "opacity-100",
      )}
    />
  );
}
