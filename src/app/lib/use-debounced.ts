// Server-side because the admin link search endpoint caps its response, so filtering in the
// browser would miss the link an abuse report names. The term is in a query key, so without
// this every keystroke was its own request.
import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    // Clearing on every change is what makes this a debounce rather than a
    // delay: only a pause longer than delayMs lets a value through.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
