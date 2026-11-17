// A zero-height bold copy, drawn by CSS from `data-label`, holds the width a selected label
// takes when bold. CSS, not a second element, so the text exists once for find-in-page,
// screen readers and tests.
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
