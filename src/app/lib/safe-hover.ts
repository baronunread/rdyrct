import { useEffect, useRef, type RefObject } from "react";

type Point = { x: number; y: number };

/** Which side of the line a→b `p` falls on. */
const side = (p: Point, a: Point, b: Point) =>
  (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);

function inTriangle(p: Point, a: Point, b: Point, c: Point) {
  const ab = side(p, a, b);
  const bc = side(p, b, c);
  const ca = side(p, c, a);
  const negative = ab < 0 || bc < 0 || ca < 0;
  const positive = ab > 0 || bc > 0 || ca > 0;
  return !(negative && positive);
}

/** How long the panel waits for a pointer that stopped inside the safe zone. */
const GRACE_MS = 300;

/**
 * Hover that survives the trip from a trigger to the panel it opens.
 *
 * Leaving the trigger does not close the panel at once. Until the pointer
 * reaches the panel, it may move anywhere inside the triangle drawn from the
 * point where it left to the panel's two top corners: the path somebody
 * takes aiming at a link in the panel's far corner. Straying outside that
 * triangle closes the panel; so does resting anywhere outside the panel for
 * GRACE_MS.
 *
 * `enter` and `leave` go on the element that holds both trigger and panel.
 */
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
