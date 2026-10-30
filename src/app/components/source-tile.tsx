import { IconArrowRight, IconWorld } from "@tabler/icons-react";
import { flagEmoji, siteLetter } from "../lib/insights-data";

/**
 * The letter tile that stands in for a site's favicon: the CSP allows no
 * remote images, and a letter is enough to find instagram.com in a list
 * without reading it. Direct traffic has no site, so it gets an arrow.
 * Decoration: the name beside it says the same thing.
 */
export function SourceTile({ source }: { source: string }) {
  const direct = source === "direct" || source === "Direct";
  return (
    <span
      aria-hidden
      className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-surface text-[10px] leading-none font-extrabold text-muted smooth-shadow-ring-xs"
    >
      {direct ? <IconArrowRight size={11} stroke={2.25} /> : siteLetter(source)}
    </span>
  );
}

/** A country's flag, drawn by the platform from its code. A click the edge
 * could not place gets a globe instead. Decoration, like SourceTile. */
export function Flag({ code }: { code: string }) {
  const flag = flagEmoji(code);
  if (!flag)
    return <IconWorld aria-hidden size={15} stroke={1.75} className="shrink-0 text-muted" />;
  return (
    <span aria-hidden className="shrink-0 text-[15px] leading-none">
      {flag}
    </span>
  );
}
