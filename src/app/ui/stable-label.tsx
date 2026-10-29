/**
 * A label that keeps its width when it turns bold. Selected segments, tabs
 * and filter chips set their label in a heavier weight, which is wider, so
 * picking one nudged its neighbours. A zero-height bold copy, drawn by CSS
 * from `data-label`, holds the width from the start. CSS, not a second
 * element, so the text exists once for find-in-page, screen readers and
 * tests.
 */
export function StableLabel({ children }: { children: string }) {
  return (
    <span
      data-label={children}
      className="inline-flex flex-col after:invisible after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-label)]"
    >
      {children}
    </span>
  );
}
