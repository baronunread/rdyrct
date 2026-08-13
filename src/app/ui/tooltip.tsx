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
        <BaseTooltip.Trigger delay={40} render={children} />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner sideOffset={6} className="z-50">
            <BaseTooltip.Popup className="max-w-xs rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-text smooth-shadow-ring-sm transition-[opacity,transform] duration-75 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
