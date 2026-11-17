import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";
import { Tooltip } from "./tooltip";
import { buttonClass, type Size, type Variant } from "./button-class";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  static?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, static: staticProp, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={buttonClass({ variant, size, static: staticProp, className })}
      {...props}
    />
  ),
);
Button.displayName = "Button";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  danger?: boolean;
  static?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, danger, static: staticProp, className, type, ...props }, ref) => (
    <Tooltip content={label}>
      <button
        ref={ref}
        type={type ?? "button"}
        aria-label={label}
        className={cn(
          "inline-flex cursor-pointer items-center justify-center rounded-md p-1.5 text-muted transition-[background-color,color,scale] duration-200 ease-out [@media(hover:hover)]:hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50",
          !staticProp && "active:scale-[0.96]",
          danger ? "hover:text-danger" : "hover:text-text",
          className,
        )}
        {...props}
      />
    </Tooltip>
  ),
);
IconButton.displayName = "IconButton";
