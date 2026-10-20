import { cn } from "./cn";

/**
 * The Hooks mark without its tile: two rounded corners hooked into each
 * other and leaning forward. The first is the r, the pair is a chain link,
 * and from far away the two strokes read as the // of a URL. The r takes the
 * text colour and its partner the accent, so it follows the theme. The tiled
 * version is the favicon and app icon (public/favicon.svg,
 * public/connector-icon.svg); next to the word, the tile would be a second
 * box around one name.
 */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="3 3 26 26" aria-hidden="true" className={cn("h-[1em] w-auto", className)}>
      <g
        transform="translate(2.8 0) skewX(-10)"
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8.6 26V12.6a4.6 4.6 0 0 1 4.6-4.6H16" stroke="currentColor" />
        <path d="M23.4 6V19.4a4.6 4.6 0 0 1-4.6 4.6H16" className="stroke-accent" />
      </g>
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
