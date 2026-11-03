import { IconArrowRight, IconWorld } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { siteLetter } from "../lib/insights-data";

/**
 * Every country's round flag (circle-flags, MIT), each its own file under
 * /assets and fetched only when a list shows it. `no-inline` keeps Vite from
 * turning the small ones into base64 inside the bundle. Bundled rather than
 * loaded from the library's site, which the CSP would refuse. Emoji flags
 * were the first try: Windows has none, and draws the two letters instead.
 */
/*
 * Loaded per flag, when a list first shows it, not all at once: eager, the
 * dev server served the ~400 files as ~400 imports at the top of this
 * module, the burst came back 502 and the whole Analytics chunk failed to
 * load. Each URL is cached once known, so a flag seen before draws at once.
 */
const FLAGS = import.meta.glob<string>("/node_modules/circle-flags/flags/*.svg", {
  query: "?no-inline",
  import: "default",
});
const known = new Map<string, string>();

/** The flag's file, or undefined for a code with no flag (an unknown
 *  country, or anything but two letters). */
function flagPath(code: string): string | undefined {
  const path = `/node_modules/circle-flags/flags/${code.toLowerCase()}.svg`;
  return /^[A-Za-z]{2}$/.test(code) && path in FLAGS ? path : undefined;
}

/** The flag's URL: at once when this page has loaded it before, else after
 *  its module arrives; undefined meanwhile, and null when it failed to load
 *  (a placeholder left for ever reads as still loading). */
function useFlagUrl(path: string | undefined): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(() =>
    path ? known.get(path) : undefined,
  );
  useEffect(() => {
    if (!path || known.has(path)) return setUrl(path ? known.get(path) : undefined);
    let live = true;
    FLAGS[path]?.()
      .then((loaded) => {
        known.set(path, loaded);
        if (live) setUrl(loaded);
      })
      .catch(() => {
        if (live) setUrl(null);
      });
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}

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
  const path = flagPath(code);
  const src = useFlagUrl(path);
  if (!path || src === null)
    return <IconWorld aria-hidden size={16} stroke={1.75} className="shrink-0 text-muted" />;
  // The flag's own circle while it loads, so the row does not move.
  if (!src) return <span aria-hidden className="size-4 shrink-0 rounded-full bg-surface-2" />;
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
