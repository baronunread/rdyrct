/**
 * The landing hero's shortener tells the globe behind it about a link it
 * just made, so the next hop on the globe carries the visitor's own link.
 * A module-level channel, not a context: the globe loads lazily and may not
 * be mounted yet, in which case the link is simply not shown.
 */
type Listener = (link: string) => void;

const listeners = new Set<Listener>();

export function onHeroHop(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** `link` is the short link as people read it, without the scheme. */
export function launchHeroHop(link: string) {
  for (const listener of listeners) listener(link);
}
