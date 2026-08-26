import { X } from "@/app/ui/icons";
import { useSyncExternalStore } from "react";
import { Button } from "../ui/button";
import {
  dismissNewVersion,
  getNewVersion,
  reloadNow,
  subscribeNewVersion,
} from "../lib/new-version";

/**
 * Shown when a code-split chunk fails to load: almost always a stale tab after
 * a deploy, whose old asset names no longer exist. We point the visitor at a
 * reload instead of crashing or auto-reloading under them. Mounted outside the
 * error boundary so it survives the boundary catching the chunk failure.
 */
export function NewVersionBanner() {
  const available = useSyncExternalStore(subscribeNewVersion, getNewVersion);
  if (!available) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 border-b border-border bg-surface px-4 py-2.5 text-sm"
    >
      <span className="text-text">A new version of the app is available.</span>
      <Button variant="primary" size="sm" onClick={reloadNow}>
        Reload
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismissNewVersion}
        className="ml-1 rounded p-1 text-muted transition-colors duration-150 hover:text-text"
      >
        <X size={16} />
      </button>
    </div>
  );
}
