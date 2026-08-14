import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";
import { buttonClass, type Size, type Variant } from "./button-class";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Disables the active:scale press feedback, for controls where it'd distract. */
  static?: boolean;
}

/** The button proper. An anchor that should look like one takes
 * `buttonClass()` instead, so the two share this look without nesting. */
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
  /** Used for both aria-label and a native tooltip — icon-only buttons must name their action. */
  label: string;
  danger?: boolean;
  /** Disables the active:scale press feedback, for controls where it'd distract. */
  static?: boolean;
}

/** Icon-only action button with consistent hover/focus and a title tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, danger, static: staticProp, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-md p-1.5 text-muted transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50",
        !staticProp && "active:scale-[0.96]",
        danger ? "hover:text-danger" : "hover:text-text",
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
