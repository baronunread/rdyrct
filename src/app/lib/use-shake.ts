import { useEffect, useMemo, useState } from "react";

/** Red flash + shake for a submit button when a check fails. Put `className`
 *  and `onAnimationEnd={end}` on the button; call `start()` on failure.
 *  Reduced-motion users never get an animationend event, so a timer also
 *  clears the red flash. */
export function useShake() {
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (!shaking) return;
    const t = setTimeout(() => setShaking(false), 500);
    return () => clearTimeout(t);
  }, [shaking]);
  // One object per shake, not per render: callers hold onto it, and a page
  // with several buttons groups them into a record that should be stable too.
  return useMemo(
    () => ({
      start: () => setShaking(true),
      end: () => setShaking(false),
      className: shaking ? "!bg-danger motion-safe:animate-shake" : undefined,
    }),
    [shaking],
  );
}
