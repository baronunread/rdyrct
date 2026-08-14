/**
 * A value that lags behind, for search boxes whose term reaches the server.
 *
 * The admin link search has to run server-side: the endpoint caps its
 * response, so filtering in the browser would only ever search the newest
 * rows and miss the link an abuse report actually names. That means the term
 * is part of a query key, and without this every keystroke was its own
 * request: typing "testing" fired eight.
 *
 * The other admin tables need none of this because they hold their whole
 * table already and filter in place.
 */
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
