/**
 * Reads a key that came from outside (a URL path, a sort parameter, a
 * subscription status) off a map whose keys are known.
 *
 * The alternative is typing the map as `Record<string, T>`, which claims an
 * entry for every string and hands back a `T` that is really `undefined`. Here
 * the caller gets `undefined` for a key that is not there, which is what the
 * runtime was always going to do, and has to say what happens then.
 */
export function lookup<T extends object>(map: T, key: string | number): T[keyof T] | undefined {
  if (!Object.hasOwn(map, key)) return undefined;
  // SAFETY: guarded by the hasOwn above, so `key` names an entry of `map`.
  return map[key as keyof T];
}

/**
 * A value that arrived as text, as one of the values it is allowed to be.
 *
 * Sort orders off a query string, roles off a select, plans off a database
 * column: each is a string until something checks it against the list. This
 * is that check, in one place, so a caller cannot forget the fallback.
 */
export function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  // SAFETY: `includes` is what decides, and it compares by value. The cast
  // only widens the argument to what the readonly array's own signature asks
  // for; a value that is not in the list leaves through the fallback.
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * The same list, typed as the non-empty one drizzle's `batch()` insists on, or
 * null when there is nothing to write.
 *
 * Callers used to assert the tuple inline, which also meant a batch of nothing
 * reached drizzle and threw. Here the empty case is a value the caller has to
 * handle.
 */
export function nonEmpty<T>(items: T[]): [T, ...T[]] | null {
  // SAFETY: the length check is on the line above.
  return items.length > 0 ? (items as [T, ...T[]]) : null;
}
