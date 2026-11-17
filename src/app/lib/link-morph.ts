import { useSyncExternalStore } from "react";

// A view transition aborts when two elements share a name, so only one row may carry the parts.
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

export function useIsMorphLink(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => current === key,
    () => false,
  );
}

export const morphPart = (part: "qr" | "title" | "addr", on = true) =>
  on ? { "data-morph": part } : {};
