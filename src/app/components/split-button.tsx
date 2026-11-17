import type { ReactNode } from "react";
import { ChevronsUpDown } from "@/app/ui/icons";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";
import { Menu } from "../ui/menu";
import { Tooltip } from "@/app/ui/tooltip";

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
  title?: string;
  menuLabel: string;
  menu: ReactNode;
}) {
  return (
    <Tooltip content={disabled ? title : undefined}>
      <div className="inline-flex shrink-0 items-stretch">
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
    </Tooltip>
  );
}
