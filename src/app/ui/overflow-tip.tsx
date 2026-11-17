import type { ReactElement, ReactNode } from "react";
import { Tooltip } from "./tooltip";

// Only a box that clips (overflow other than visible) can be cut, so a child that merely
// sticks out of a roomy parent does not count.
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

export function OverflowTip({
  content,
  children,
  side,
}: {
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
