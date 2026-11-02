import { IconArrowRight, IconWorld } from "@tabler/icons-react";
import { siteLetter } from "../lib/insights-data";

/**
 * Every country's round flag (circle-flags, MIT), each its own file under
 * /assets and fetched only when a list shows it. `no-inline` keeps Vite from
 * turning the small ones into base64 inside the bundle. Bundled rather than
 * loaded from the library's site, which the CSP would refuse. Emoji flags
 * were the first try: Windows has none, and draws the two letters instead.
 */
const FLAGS = import.meta.glob<string>("/node_modules/circle-flags/flags/*.svg", {
  query: "?no-inline",
  import: "default",
  eager: true,
});

const flagUrl = (code: string): string | undefined =>
  /^[A-Za-z]{2}$/.test(code)
    ? FLAGS[`/node_modules/circle-flags/flags/${code.toLowerCase()}.svg`]
    : undefined;

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

/** A country's round flag. A click the edge could not place gets a globe
 * instead. Decoration, like SourceTile: the name beside it says the same. */
export function Flag({ code }: { code: string }) {
  const src = flagUrl(code);
  if (!src)
    return <IconWorld aria-hidden size={16} stroke={1.75} className="shrink-0 text-muted" />;
  return (
    <img
      src={src}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      className="size-4 shrink-0 rounded-full smooth-shadow-ring-xs"
    />
  );
}
