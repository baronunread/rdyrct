import { useLayoutEffect, type RefObject } from "react";

/**
 * Fades the edge of a sideways-scrolling row that has more behind it
 * (`[data-fade]` in styles.css), so a row of filters cut off by a narrow
 * window says there is more instead of looking complete. Nothing fades when
 * everything fits.
 */
/** By hidden edges: none, right, left, both. "none" matches no rule. */
const FADES = ["none", "right", "left", "both"] as const;

export function useScrollFade(row: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      el.dataset.fade = FADES[Number(left) * 2 + Number(right)];
    };
    update();
    // Once per mount: a resize of the row, or a change to what is in it
    // (a filter's count, a chip coming or going), is what moves the edges.
    const resized = new ResizeObserver(update);
    resized.observe(el);
    const changed = new MutationObserver(update);
    changed.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      resized.disconnect();
      changed.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [row]);
}
