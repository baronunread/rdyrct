/** `Record<string, T>` would claim an entry for every string; here an unknown key gives `undefined`. */
export function lookup<T extends object>(map: T, key: string | number): T[keyof T] | undefined {
  if (!Object.hasOwn(map, key)) return undefined;
  // SAFETY: guarded by the hasOwn above, so `key` names an entry of `map`.
  return map[key as keyof T];
}

export function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  // SAFETY: `includes` decides by value; the cast only widens the argument to what the array's signature asks.
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** The non-empty tuple drizzle's `batch()` insists on, or null: a batch of nothing would throw there. */
export function nonEmpty<T>(items: T[]): [T, ...T[]] | null {
  // SAFETY: the length check is on the line above.
  return items.length > 0 ? (items as [T, ...T[]]) : null;
}
