import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function apply(next: Theme) {
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
  listeners.forEach((cb) => cb());
}

function toggle() {
  const next: Theme = current() === "light" ? "dark" : "light";

  // The cross-fade is the browser's, not ours: it snapshots the page before
  // and after and fades the two on the compositor, so the work does not grow
  // with the number of elements on the page (see the note in styles.css).
  // Where the API is missing, the palette just swaps. A swap is the honest
  // fallback: it is what the fade is hiding, and it is 4ms.
  if (document.startViewTransition) document.startViewTransition(() => apply(next));
  else apply(next);
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, current);
  return [theme, toggle];
}
