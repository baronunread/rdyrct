import { useLayoutEffect, useRef, type RefObject } from "react";
import { cn } from "./cn";

/**
 * The underline of a tab bar whose tabs are links or plain buttons (API,
 * Platform): one bar that slides to the current tab, instead of each tab
 * drawing its own and the line jumping. PanelTabs gets the same from Base
 * UI's Tabs.Indicator.
 *
 * It follows whichever child of `bar` has `aria-current="page"`, measured
 * after every render and whenever the bar changes size (fonts loading, a
 * phone turning). The first placement does not animate: a page opens with
 * its underline in place, not sliding in from the left.
 */
export function TabUnderline({
  bar,
  className,
}: {
  bar: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const line = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = bar.current;
    const underline = line.current;
    if (!el || !underline) return;
    const place = () => {
      const current = el.querySelector<HTMLElement>('[aria-current="page"]');
      underline.style.opacity = current ? "1" : "0";
      if (!current) return;
      underline.style.width = `${current.offsetWidth}px`;
      underline.style.translate = `${current.offsetLeft}px 0`;
    };
    place();
    // Animate from the second placement on.
    const raf = requestAnimationFrame(() => underline.removeAttribute("data-still"));
    const resized = new ResizeObserver(place);
    resized.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      resized.disconnect();
    };
  });

  return (
    <span
      ref={line}
      aria-hidden
      data-still=""
      className={cn(
        "pointer-events-none absolute bottom-0 left-0 h-[1.5px] bg-text transition-[translate,width] duration-200 ease-out data-[still]:transition-none motion-reduce:transition-none",
        className,
      )}
    />
  );
}
