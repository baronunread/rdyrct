import type { ReactNode } from "react";
import { ChevronsUpDown } from "@/app/ui/icons";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";
import { Menu } from "../ui/menu";

/**
 * A primary action with its alternatives beside it: "Invite", and behind the
 * chevron the other ways to do the same job. One control to the eye, two tab
 * stops, the two halves split by a hairline of the page.
 */
export function SplitButton({
  children,
  onClick,
  disabled,
  title,
  menuLabel,
  menu,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is disabled, on hover. */
  title?: string;
  /** Names the chevron: "More ways to invite". */
  menuLabel: string;
  /** The menu's items. */
  menu: ReactNode;
}) {
  return (
    <div className="inline-flex shrink-0 items-stretch" title={disabled ? title : undefined}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={buttonClass({ variant: "primary", className: "rounded-r-none pr-3" })}
      >
        {children}
      </button>
      {disabled ? (
        <span
          aria-hidden
          className={buttonClass({
            variant: "primary",
            className:
              "pointer-events-none w-9 rounded-l-none px-0 opacity-50 shadow-[inset_1px_0_0_color-mix(in_oklab,var(--bg)_45%,transparent)]",
          })}
        >
          <ChevronsUpDown size={14} />
        </span>
      ) : (
        <div className="w-9">
          <Menu
            align="end"
            label={menuLabel}
            trigger={
              <span
                className={cn(
                  buttonClass({ variant: "primary" }),
                  "w-9 rounded-l-none px-0 shadow-[inset_1px_0_0_color-mix(in_oklab,var(--bg)_45%,transparent)]",
                )}
              >
                <ChevronsUpDown size={14} aria-hidden />
              </span>
            }
          >
            {menu}
          </Menu>
        </div>
      )}
    </div>
  );
}
