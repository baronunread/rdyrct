import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function apply(next: Theme) {
  const root = document.documentElement;
  // Transitions off for the swap (styles.css, [data-theme-switching]), so
  // the colours change in one frame. Reading a computed style flushes the
  // new theme's styles before the flag comes off, or the transitions run anyway.
  root.dataset.themeSwitching = "";
  root.dataset.theme = next;
  void getComputedStyle(root).color;
  delete root.dataset.themeSwitching;
  localStorage.setItem("theme", next);
  listeners.forEach((cb) => cb());
}

function toggle() {
  const next: Theme = currentTheme() === "light" ? "dark" : "light";

  // No view transition: any crossfade between near-opposite flat colors reads as a wrong
  // gray midpoint, and the header's backdrop-filter makes its snapshot come out wrong
  // regardless of blend mode. A plain swap is the fallback path.
  apply(next);
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    currentTheme,
    (): Theme => "light",
  );
  return [theme, toggle];
}
