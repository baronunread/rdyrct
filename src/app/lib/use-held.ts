import { useEffect, useState } from "react";

/** `value`, or while it is null the last value it had: a dialog keeps what
 * it shows while it fades out, rather than emptying under the animation. */
export function useHeld<T>(value: T | null): T | null {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (value) setHeld(value);
  }, [value]);
  return value ?? held;
}
