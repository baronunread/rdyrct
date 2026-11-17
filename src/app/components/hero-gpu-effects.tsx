/**
 * Loaded lazily, and only when `hasWebGpu()` said yes, so TypeGPU never reaches a
 * browser that cannot use it. A GPU that refuses leaves the canvas transparent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../ui/cn";
import { startEdgeLight, startHeroBackdrop } from "../lib/hero-gpu";

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

/** 100vw counts the scrollbar, so styles.css clips the page sideways (`[data-hero]`). */
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

const EDGE_INSET = 40;

export type EdgeLightProps = {
  frame: React.RefObject<HTMLElement | null>;
  radius: number;
};

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
