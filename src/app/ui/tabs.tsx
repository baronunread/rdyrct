import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { useState, type ReactNode } from "react";
import { cn } from "./cn";
import { StableLabel } from "./stable-label";

function cornerOf(
  tabs: { value: string; end?: ReactNode }[],
  active: string | undefined,
  fallback: ReactNode,
): ReactNode {
  return tabs.find((t) => t.value === active)?.end ?? fallback;
}

export function PanelTabs({
  tabs,
  defaultValue,
  end,
  className,
}: {
  tabs: { value: string; label: string; count?: number; panel: ReactNode; end?: ReactNode }[];
  defaultValue?: string;
  end?: ReactNode;
  className?: string;
}) {
  const [active, setActive] = useState(defaultValue ?? tabs[0]?.value);
  const corner = cornerOf(tabs, active, end);
  return (
    <BaseTabs.Root
      value={active}
      onValueChange={(value: string) => setActive(value)}
      className={cn("rounded-xl bg-surface px-4 pt-3 pb-3.5 smooth-shadow-ring-xs", className)}
    >
      <div className="mb-3 flex items-center gap-4 shadow-[inset_0_-1px_0_var(--border)]">
        <BaseTabs.List className="relative flex min-w-0 gap-4 overflow-x-auto">
          {tabs.map((tab) => (
            <BaseTabs.Tab
              key={tab.value}
              value={tab.value}
              className="cursor-pointer pb-2.5 text-sm whitespace-nowrap text-muted outline-none focus-visible:text-text data-[active]:font-semibold data-[active]:text-text [@media(hover:hover)]:hover:text-text"
            >
              <StableLabel>{tab.label}</StableLabel>
              {tab.count !== undefined && (
                <span className="tnum ml-1.5 font-normal text-muted">{tab.count}</span>
              )}
            </BaseTabs.Tab>
          ))}
          {/* One underline that slides to the chosen tab; the panel itself swaps at once. */}
          <BaseTabs.Indicator className="absolute bottom-0 left-0 h-[1.5px] w-(--active-tab-width) translate-x-(--active-tab-left) bg-text transition-[translate,width] duration-200 ease-out motion-reduce:transition-none" />
        </BaseTabs.List>
        {corner && <div className="ml-auto shrink-0 pb-2.5 text-xs text-muted">{corner}</div>}
      </div>
      {/* Every panel stays mounted in the same grid cell and only the active one is visible, so
         the card is as tall as its tallest list and switching tabs never moves it. */}
      <div className="grid">
        {tabs.map((tab) => (
          <BaseTabs.Panel
            key={tab.value}
            value={tab.value}
            keepMounted
            // Base UI hides an inactive panel with `hidden`, which Tailwind's base layer turns into
            // display: none !important. Dropped here: the panel keeps its place but goes invisible
            // (data-hidden), and Base UI's `inert` keeps it out of focus and the a11y tree.
            render={(props) => <div {...props} hidden={undefined} />}
            className="col-start-1 row-start-1 min-w-0 data-[hidden]:invisible"
          >
            {tab.panel}
          </BaseTabs.Panel>
        ))}
      </div>
    </BaseTabs.Root>
  );
}
