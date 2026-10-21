import { cn } from "./cn";

/**
 * The Hop mark without its tile: a click leaves one place, arcs, and lands.
 * The arc takes the text colour and the landing dot the accent, so it follows
 * the theme. The tiled version is the favicon and app icon (public/favicon.svg,
 * public/connector-icon.svg); next to the word, the tile would be a second
 * box around one name.
 */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="3.6 7 23.6 17.8" aria-hidden="true" className={cn("h-[0.9em] w-auto", className)}>
      <path
        d="M6.6 20Q13.4 2.2 19 12.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="6.6" cy="20" r="2.5" fill="currentColor" />
      <circle cx="22.4" cy="17.4" r="3.6" className="fill-accent" />
      <ellipse cx="22.4" cy="23.3" rx="4.3" ry="1.05" className="fill-border" />
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
