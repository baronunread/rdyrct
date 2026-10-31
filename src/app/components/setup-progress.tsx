import { Link } from "@tanstack/react-router";
import { useSetup } from "../lib/setup-steps";

/**
 * The setup list's count, at the foot of the sidebar while the list is open:
 * how far along, from any page, and the way back to it. Gone with the list.
 * A folded sidebar has no room for words, so it shows nothing there.
 */
export function SetupProgress({ collapsed }: { collapsed: boolean }) {
  const setup = useSetup();
  if (!setup || collapsed) return null;
  const share = Math.round((setup.done / setup.total) * 100);
  return (
    <div className="px-3 pt-2">
      <Link
        to="/dashboard"
        className="flex flex-col gap-2 rounded-[10px] bg-surface px-3 py-2.5 smooth-shadow-ring-xs [@media(hover:hover)]:hover:bg-surface-2"
      >
        <span className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold">Get set up</span>
          <span className="text-muted tabular-nums">
            {setup.done} of {setup.total}
          </span>
        </span>
        <span
          role="progressbar"
          aria-label="Setup"
          aria-valuemin={0}
          aria-valuemax={setup.total}
          aria-valuenow={setup.done}
          className="relative h-[5px] overflow-hidden rounded-full bg-surface-2"
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
            style={{ width: `${share}%` }}
          />
        </span>
      </Link>
    </div>
  );
}
