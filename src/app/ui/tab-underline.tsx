import { useLayoutEffect, useRef, type RefObject } from "react";
import { cn } from "./cn";

/**
 * Keeps an absolutely placed element (an underline, a segmented control's
 * pill) over whichever child of `bar` matches `selector`: as wide as it,
 * moved across to it. Measured after every render and whenever the bar
 * changes size (fonts loading, a phone turning). The first placement does
 * not animate (the element starts with `data-still`), so a page opens with
 * it in place, not sliding in from the left.
 */
export function useSlideTo<T extends HTMLElement>(
  bar: RefObject<HTMLElement | null>,
  selector: string,
) {
  const slider = useRef<T>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    const moving = slider.current;
    if (!el || !moving) return;
    const place = () => {
      const current = el.querySelector<HTMLElement>(selector);
      moving.style.opacity = current ? "1" : "0";
      if (!current) return;
      moving.style.width = `${current.offsetWidth}px`;
      moving.style.translate = `${current.offsetLeft}px 0`;
    };
    place();
    // Animate from the second placement on.
    const raf = requestAnimationFrame(() => moving.removeAttribute("data-still"));
    const resized = new ResizeObserver(place);
    resized.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      resized.disconnect();
    };
  });
  return slider;
}

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
  const line = useSlideTo<HTMLSpanElement>(bar, '[aria-current="page"]');
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
