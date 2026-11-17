import { useEffect, useMemo, useState } from "react";

// Reduced-motion users never get an animationend event, so a timer also
// clears the red flash.
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
