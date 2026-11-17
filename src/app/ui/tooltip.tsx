import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";

export function TooltipGroup({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={350} closeDelay={0} timeout={400}>
      {children}
    </BaseTooltip.Provider>
  );
}

const ALONE = { delay: 40, closeDelay: 120 };

const POPUP =
  "max-w-xs origin-[var(--transform-origin)] rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-text transition-[opacity,scale] duration-125 ease-out smooth-shadow-ring-sm data-[ending-style]:opacity-0 data-[instant]:duration-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 motion-reduce:transition-none";

// A label in a row of them goes the moment the pointer leaves: a fade there
// trails behind somebody already looking elsewhere.
const GROUPED_POPUP = "data-[ending-style]:duration-0";

export function Tooltip({
  content,
  children,
  side,
  grouped,
  guard,
}: {
  content?: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  grouped?: boolean;
  guard?: (trigger: HTMLElement) => boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const guarded = guard
    ? {
        open,
        onOpenChange: (next: boolean) =>
          setOpen(next && triggerRef.current !== null && guard(triggerRef.current)),
      }
    : {};
  if (content === undefined || content === null || content === "") return children;
  const root = (
    <BaseTooltip.Root {...guarded}>
      {/* Base UI waits 600ms by default, tuned for tooltips that repeat a control's own label.
         Ours carry advice nobody gets otherwise, so waiting costs more than showing it. */}
      {/* closeDelay, because the trigger is a 13px mark and the pointer wobbles: leaving instantly
         started a close, re-entered, and started again, so the fade stuttered. A tenth of a
         second absorbs that. */}
      <BaseTooltip.Trigger ref={triggerRef} {...(grouped ? {} : ALONE)} render={children} />
      <BaseTooltip.Portal>
        {/* Above every dialog, the nested ones (z-[70]) included: a tooltip
           is transient and always explains what is on top of it. */}
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-[100]">
          {/* It fades out without the scale: an exit can be cut short by the pointer coming back,
             and a size snapping mid-flight is far more visible. data-instant means not opened by
             hovering (keyboard focus, a second tip), where an animation is a delay. */}
          <BaseTooltip.Popup className={cn(POPUP, grouped && GROUPED_POPUP)}>
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
  return grouped ? root : <BaseTooltip.Provider>{root}</BaseTooltip.Provider>;
}
