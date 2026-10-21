import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function apply(next: Theme) {
  const root = document.documentElement;
  // Transitions off for the swap (styles.css, [data-theme-switching]), so
  // the colours change in one frame. Reading a computed style flushes the
  // new theme's styles before the flag comes off; without it the browser
  // batches both changes and the transitions run anyway.
  root.dataset.themeSwitching = "";
  root.dataset.theme = next;
  void getComputedStyle(root).color;
  delete root.dataset.themeSwitching;
  localStorage.setItem("theme", next);
  listeners.forEach((cb) => cb());
}

function toggle() {
  const next: Theme = current() === "light" ? "dark" : "light";

  // No view transition here: dark and light are near-opposite flat colors,
  // so any crossfade between them (soft or instant-cut) reads as a wrong
  // gray midpoint, and the header's backdrop-filter makes its own
  // view-transition snapshot come out wrong regardless of blend mode. The
  // transition API buys nothing a plain swap doesn't already have here, so
  // this always takes the fallback path — styles.css's crossfade exists for
  // marketing-to-marketing navigation (the viewTransition Links in
  // landing-header.tsx), not this.
  apply(next);
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
    (): Theme => "light",
  );
  return [theme, toggle];
}
