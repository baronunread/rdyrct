import { useEffect, useRef } from "react";

export function useHeld<T>(value: T | null): T | null {
  const held = useRef(value);
  useEffect(() => {
    if (value) held.current = value;
  }, [value]);
  return value ?? held.current;
}
