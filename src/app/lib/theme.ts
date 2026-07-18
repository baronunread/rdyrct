import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
  );
  const toggle = () => {
    const next: Theme = current() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
    listeners.forEach((cb) => cb());
  };
  return [theme, toggle];
}
