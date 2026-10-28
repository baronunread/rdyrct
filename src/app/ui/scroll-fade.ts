import { useLayoutEffect, type RefObject } from "react";

/**
 * Fades the edge of a sideways-scrolling row that has more behind it
 * (`[data-fade]` in styles.css), so a row of filters cut off by a narrow
 * window says there is more instead of looking complete. Nothing fades when
 * everything fits.
 */
export function useScrollFade(row: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      const fade = left && right ? "both" : left ? "left" : right ? "right" : "";
      if (fade) el.dataset.fade = fade;
      else delete el.dataset.fade;
    };
    update();
    const resized = new ResizeObserver(update);
    resized.observe(el);
    for (const child of el.children) resized.observe(child);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      resized.disconnect();
      el.removeEventListener("scroll", update);
    };
  });
}
