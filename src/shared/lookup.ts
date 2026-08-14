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
