import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

export function Tooltip({ content, children }: { content: ReactNode; children: ReactElement }) {
  return (
    <BaseTooltip.Provider>
      <BaseTooltip.Root>
        <BaseTooltip.Trigger render={children} />
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner sideOffset={6} className="z-50">
            <BaseTooltip.Popup className="max-w-xs rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text shadow transition-[opacity,transform] duration-100 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
