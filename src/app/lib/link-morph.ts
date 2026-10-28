import { useSyncExternalStore } from "react";

/**
 * Which link the Links ⇄ link page morph is about (`link-morph` in
 * styles.css): its QR code, title and address travel between its row and the
 * page header.
 *
 * A view transition aborts when two elements share a name, so only one row
 * may carry the parts: the one clicked (marked before the click navigates,
 * so the old snapshot has it), or the one the link page came from (the page
 * marks its own link on mount, so the way back finds the same row).
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export const morphKey = (link: { slug: string; domain?: string | null }) =>
  `${link.domain ?? ""}/${link.slug}`;

export function setMorphLink(key: string) {
  if (current === key) return;
  current = key;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether this row is the one the morph is about. */
export function useIsMorphLink(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => current === key,
    () => false,
  );
}

/** The attribute that marks one moving part, or nothing. */
export const morphPart = (part: "qr" | "title" | "addr", on = true) =>
  on ? { "data-morph": part } : {};
