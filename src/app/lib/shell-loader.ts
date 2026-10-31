import { createElement, lazy, useState, type ComponentProps, type ComponentType } from "react";

/**
 * The app shell's code, loaded once and shared by everything that needs it.
 *
 * main.tsx renders the shell lazily. React.lazy suspends on its first render
 * even when the chunk is already in the browser, so a page change into the
 * app always drew the shell's skeleton for a frame. That frame is what a
 * view transition captures, which turned the sign-in card's hand-over into a
 * card fading over a skeleton (lib/setup-arrive.ts). Once `loadShell` has
 * resolved, the parts below render the shell directly and nothing suspends.
 */

type Shell = typeof import("../routes/shell");

let loaded: Shell | undefined;
let loading: Promise<Shell> | undefined;

export function loadShell(): Promise<Shell> {
  // A failed chunk is not remembered: the next caller tries again.
  loading ??= import("../routes/shell").then(
    (m) => (loaded = m),
    (error: Error) => {
      loading = undefined;
      throw error;
    },
  );
  return loading;
}

/** One of the shell's exports: direct once loaded, lazy until then. Chosen
 * once per mount, so a part never swaps component type under itself. */
function shellPart<P extends object>(pick: (shell: Shell) => ComponentType<P>) {
  const Lazy = lazy(() => loadShell().then((m) => ({ default: pick(m) })));
  return function ShellPart(props: P) {
    const [Part] = useState<ComponentType<P>>(() => (loaded ? pick(loaded) : Lazy));
    return createElement(Part, props);
  };
}

export const AppShellPart = shellPart<ComponentProps<Shell["AppShell"]>>((m) => m.AppShell);
export const RequireAuthPart = shellPart<ComponentProps<Shell["RequireAuth"]>>(
  (m) => m.RequireAuth,
);
export const RequireAdminPart = shellPart<ComponentProps<Shell["RequireAdmin"]>>(
  (m) => m.RequireAdmin,
);
