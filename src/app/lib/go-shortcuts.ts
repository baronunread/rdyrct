import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { isShortcut } from "./shortcut";

/**
 * "G then D" goes to the dashboard, as in Linear and GitHub. One table, read
 * by the listener below and by ⌘K, which shows each pair at the end of its
 * row, so a hint can never name a key that does nothing.
 */
export const GO_KEYS = {
  "/dashboard": "D",
  "/analytics": "A",
  "/links": "L",
  "/members": "M",
} as const satisfies Record<string, string>;

/** How long the second key has after G. */
const WINDOW_MS = 1200;

function targetFor(key: string): string | undefined {
  const upper = key.toUpperCase();
  return Object.entries(GO_KEYS).find(([, k]) => k === upper)?.[0];
}

/** Mounted once, in the app shell. Never while typing, and never with a
 * dialog open: its own keys come first. */
export function useGoShortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    let armedAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) {
        armedAt = 0;
        return;
      }
      const now = e.timeStamp || performance.now();
      if (armedAt && now - armedAt < WINDOW_MS) {
        armedAt = 0;
        const to = isShortcut(e, e.key.toLowerCase()) ? targetFor(e.key) : undefined;
        if (!to) return;
        e.preventDefault();
        void navigate({ to });
        return;
      }
      armedAt = isShortcut(e, "g") ? now : 0;
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);
}
