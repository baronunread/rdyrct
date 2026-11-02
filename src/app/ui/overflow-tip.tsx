import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "./tooltip";

/** True when the element, or something inside it, hides some of its text: a
 * `truncate` cut sideways or a `line-clamp` cut downward. Only a box that
 * clips (overflow other than visible) can be cut, so a child that merely
 * sticks out of a roomy parent does not count. */
function isCut(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    if (
      getComputedStyle(el).overflowX === "visible" &&
      getComputedStyle(el).overflowY === "visible"
    )
      continue;
    if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

/**
 * Shows the full text of a truncated element in the app's tooltip, and only
 * while the text is actually cut off: it measures on pointer enter or focus,
 * so a value that fits gets no tooltip. The child is the element that
 * truncates (a span, a Td, a link). It stays as it is, so plain text is not
 * a tab stop, and a link keeps its own focus.
 */
export function OverflowTip({
  content,
  children,
  side,
}: {
  /** The full text. Empty means no tooltip. */
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Tooltip content={content} side={side} guard={isCut}>
      {children}
    </Tooltip>
  );
}
