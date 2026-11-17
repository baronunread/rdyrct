import { IconArrowRight, IconWorld } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { siteLetter } from "../lib/insights-data";

/** Bundled, not loaded from the library site, which the CSP would refuse. `no-inline`
 * keeps Vite from turning the small files into base64 in the bundle. */
/* Loaded per flag: eager, the dev server served ~400 imports at once, the burst
 * came back 502 and the whole Analytics chunk failed to load. */
const FLAGS = import.meta.glob<string>("/node_modules/circle-flags/flags/*.svg", {
  query: "?no-inline",
  import: "default",
});
const known = new Map<string, string>();

function flagPath(code: string): string | undefined {
  const path = `/node_modules/circle-flags/flags/${code.toLowerCase()}.svg`;
  return /^[A-Za-z]{2}$/.test(code) && path in FLAGS ? path : undefined;
}

/** null when the flag failed to load: a placeholder left for ever reads as still loading. */
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

export function Flag({ code }: { code: string }) {
  const path = flagPath(code);
  const src = useFlagUrl(path);
  if (!path || src === null)
    return <IconWorld aria-hidden size={16} stroke={1.75} className="shrink-0 text-muted" />;
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
