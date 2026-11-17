import { useEffect, useRef, type RefObject } from "react";

type Point = { x: number; y: number };

const side = (p: Point, a: Point, b: Point) =>
  (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);

function inTriangle(p: Point, a: Point, b: Point, c: Point) {
  const sides = [side(p, a, b), side(p, b, c), side(p, c, a)];
  return sides.every((v) => v >= 0) || sides.every((v) => v <= 0);
}

const GRACE_MS = 300;

// The panel stays open while the pointer is inside the triangle from where it left the trigger
// to the panel's two top corners, the path somebody takes aiming at the far corner.
// Straying outside, or resting outside the panel for GRACE_MS, closes it.
export function useSafeHover(
  panel: RefObject<HTMLElement | null>,
  setOpen: (open: boolean) => void,
) {
  const stop = useRef<(() => void) | null>(null);
  const cancel = () => {
    stop.current?.();
    stop.current = null;
  };
  useEffect(() => cancel, []);

  const enter = () => {
    cancel();
    setOpen(true);
  };

  const leave = (from: Point) => {
    cancel();
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return setOpen(false);
    const left = { x: rect.left, y: rect.top };
    const right = { x: rect.right, y: rect.top };

    let timer = 0;
    const close = () => {
      cancel();
      setOpen(false);
    };
    const move = (event: PointerEvent) => {
      const at = { x: event.clientX, y: event.clientY };
      if (!inTriangle(at, from, left, right)) return close();
      clearTimeout(timer);
      timer = window.setTimeout(close, GRACE_MS);
    };
    timer = window.setTimeout(close, GRACE_MS);
    document.addEventListener("pointermove", move);
    stop.current = () => {
      clearTimeout(timer);
      document.removeEventListener("pointermove", move);
    };
  };

  return { enter, leave, cancel };
}
