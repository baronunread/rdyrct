import { cn } from "./cn";

/**
 * The Loop mark without its tile: one stroke ties a loop and lets go of the
 * dot, a link sent on its way. The stroke takes the text colour and the dot
 * the accent, so it follows the theme. The tiled version is the favicon and
 * app icon (public/favicon.svg, public/connector-icon.svg); next to the word,
 * the tile would be a second box around one name.
 */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="2.1 4.6 27.9 21.8"
      aria-hidden="true"
      className={cn("h-[0.95em] w-auto", className)}
    >
      <path
        d="M4 24.5C9 24 19 18.5 19 11C19 5 9 5 9 11C9 17 14.5 19.6 19 19.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.8"
        strokeLinecap="round"
      />
      <circle cx="26" cy="18" r="4" className="fill-accent" />
    </svg>
  );
}

/** Mark and name together. The size comes from the font size it sits in. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-[0.4em] font-bold tracking-tight", className)}
    >
      <LogoMark />
      rdyrct
    </span>
  );
}
