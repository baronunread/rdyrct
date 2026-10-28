import { useEffect, useState } from "react";

/** `value`, or while it is null the last value it had: a dialog keeps what
 * it shows while it fades out, rather than emptying under the animation. */
export function useHeld<T>(value: T | null): T | null {
  // react-doctor-disable-next-line react-doctor/no-derived-state -- what it holds is a past value, which the current props no longer carry.
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (value) setHeld(value);
  }, [value]);
  return value ?? held;
}
