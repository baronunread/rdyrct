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
 * the shell's skeleton so the first paint already has the right width.
 *
 * Folded, what reads as the rail is the strip of paper up to the sheet: the
 * aside plus the 8px gap. Every icon's centre sits 30px in (12px padding,
 * then half a 36px item), so the aside is 52px and the strip 60. Its items
 * keep their 36px (`min-w-9`) and run into the right-hand padding.
 *
 * On a desktop the sheet is what scrolls, as in Polar: a scrollbar that
 * takes room (Windows, Linux) sits inside the sheet's own edge, and a short
 * page leaves no empty gutter beside it (styles.css, [data-app-sheet]). */
export function shellLayout(collapsed: boolean) {
  return {
    aside: cn(
      "fixed inset-y-0 left-0 z-10 hidden transition-[width] duration-200 ease-out md:block",
      collapsed ? "w-[52px]" : "w-60",
    ),
    main: cn(
      "mx-1.5 mt-[52px] mb-1.5 flex min-w-0 flex-1 flex-col rounded-[22px] bg-surface smooth-shadow-ring-sm transition-[margin] duration-200 ease-out md:my-2 md:mr-2 md:h-[calc(100dvh-1rem)] md:rounded-[14px]",
      collapsed ? "md:ml-[60px]" : "md:ml-[248px]",
    ),
    // What scrolls on a desktop: inset 8px from the sheet's top and bottom
    // and 4px from its right, so the scrollbar's square ends stay clear of
    // the rounded corners. The padding makes up the inset (32px, 40px).
    scroller:
      "flex flex-1 flex-col px-4 py-6 md:my-2 md:mr-1 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:py-6 md:pr-9 md:pl-10",
  };
}
