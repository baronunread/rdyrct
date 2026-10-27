import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Several lists in one card, switched by underline tabs (rdyrct-design, "The
 * app's surfaces"): "Top links · Decaying · Dead", "Referrers · Campaigns".
 * The tab names the list, so the card needs no title of its own. Base UI owns
 * the keyboard and ARIA: arrow keys move between tabs, Tab moves into the
 * panel.
 */
export function PanelTabs({
  tabs,
  defaultValue,
  end,
  className,
}: {
  tabs: { value: string; label: ReactNode; panel: ReactNode }[];
  defaultValue?: string;
  /** Something on the right of the tab row, e.g. an "All links" link. */
  end?: ReactNode;
  className?: string;
}) {
  return (
    <BaseTabs.Root
      defaultValue={defaultValue ?? tabs[0]?.value}
      className={cn("rounded-xl bg-surface px-4 pt-3 pb-3.5 smooth-shadow-ring-xs", className)}
    >
      <div className="mb-3 flex items-center gap-4 shadow-[inset_0_-1px_0_var(--border)]">
        <BaseTabs.List className="flex min-w-0 gap-4 overflow-x-auto">
          {tabs.map((tab) => (
            <BaseTabs.Tab
              key={tab.value}
              value={tab.value}
              className="cursor-pointer pb-2.5 text-sm whitespace-nowrap text-muted outline-none focus-visible:text-text data-[active]:font-semibold data-[active]:text-text data-[active]:shadow-[inset_0_-1.5px_0_var(--text)] [@media(hover:hover)]:hover:text-text"
            >
              {tab.label}
            </BaseTabs.Tab>
          ))}
        </BaseTabs.List>
        {end && <div className="ml-auto shrink-0 pb-2.5 text-xs text-muted">{end}</div>}
      </div>
      {tabs.map((tab) => (
        <BaseTabs.Panel key={tab.value} value={tab.value}>
          {tab.panel}
        </BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
