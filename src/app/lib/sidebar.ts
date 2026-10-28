import { useEffect, useSyncExternalStore } from "react";
import { cn } from "../ui/cn";
import { isShortcut } from "./shortcut";

/**
 * Whether the desktop sidebar is folded to its icon rail. Kept in
 * localStorage, so it is read before the first paint and a reload does not
 * open the sidebar only to fold it again.
 */
const KEY = "sidebar";
const listeners = new Set<() => void>();

function read(): boolean {
  return localStorage.getItem(KEY) === "collapsed";
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function toggleSidebar() {
  if (read()) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, "collapsed");
  listeners.forEach((cb) => cb());
}

export function useSidebarCollapsed(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

/** `[` folds and unfolds it, as in Linear, except while typing. */
export function useSidebarShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcut(e, "[")) toggleSidebar();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

/** The desktop sidebar and the sheet beside it, open or folded. Shared with
 * the shell's skeleton so the first paint already has the right width. */
export function shellLayout(collapsed: boolean) {
  return {
    aside: cn(
      "fixed inset-y-0 left-0 z-10 hidden transition-[width] duration-200 ease-out md:block",
      collapsed ? "w-[60px]" : "w-60",
    ),
    main: cn(
      "mx-1.5 mt-[52px] mb-1.5 flex min-w-0 flex-1 flex-col rounded-[22px] bg-surface px-4 py-6 smooth-shadow-ring-sm transition-[margin] duration-200 ease-out md:my-2 md:mr-2 md:rounded-[14px] md:px-10 md:py-8",
      collapsed ? "md:ml-[68px]" : "md:ml-[248px]",
    ),
  };
}
