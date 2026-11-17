import { useLayoutEffect, useRef, type RefObject } from "react";
import { cn } from "./cn";

// The first placement does not animate (the element starts with `data-still`), so a page
// opens with it in place, not sliding in from the left.
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

// PanelTabs gets the same from Base UI's Tabs.Indicator. It follows the child with
// `aria-current="page"`, remeasured after every render and on resize.
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
