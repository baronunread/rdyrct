import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root>
        {/* Base UI waits 600ms by default, which is tuned for tooltips that
            repeat a control's own label. Ours carry advice you cannot get any
            other way, so waiting to be sure somebody meant it costs more than
            showing it to somebody passing through. */}
        {/* closeDelay, because the trigger is a 13px mark and the pointer
            wobbles: leaving instantly meant a sweep across it started a close,
            re-entered, and started again, so the fade stuttered instead of
            running once. A tenth of a second absorbs that and is still gone
            before anyone reads it as lag. */}
        <BaseTooltip.Trigger delay={40} closeDelay={120} render={children} />
        <BaseTooltip.Portal>
          {/* Above every dialog, the nested ones (z-[70]) included: a tooltip
              is transient and always explains what is on top of it. */}
          <BaseTooltip.Positioner sideOffset={6} className="z-[100]">
            {/* It grows out of the mark that opened it, rather than out of
                its own middle: --transform-origin is the anchor's side, so a
                tip above a control expands downward toward it and one below
                expands upward. 125ms and ease-out, fast enough to keep out of
                the way and decelerating so it settles rather than stops.
                Scale 0.97, because a tooltip is small and anything deeper
                reads as a pop. It fades out without the scale: an exit can
                still be cut short by the pointer coming back, and a size
                snapping mid-flight is far more visible than an opacity one.

                data-instant is Base UI saying this one was not opened by
                hovering (keyboard focus, or a second tip while one is already
                up), where an animation is a delay nobody asked for. */}
            <BaseTooltip.Popup className="max-w-xs origin-[var(--transform-origin)] rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-text transition-[opacity,scale] duration-125 ease-out smooth-shadow-ring-sm data-[ending-style]:opacity-0 data-[instant]:duration-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 motion-reduce:transition-none">
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
