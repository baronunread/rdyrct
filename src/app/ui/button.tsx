import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-bg font-bold hover:brightness-110 active:brightness-95",
  outline: "border border-border bg-surface hover:border-accent hover:text-accent",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
  danger: "border border-border text-danger hover:border-danger hover:bg-danger/10",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Disables the active:scale press feedback, for controls where it'd distract. */
  static?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "outline", size = "md", static: staticProp, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-md transition-[background,border-color,color,filter,scale] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50",
        !staticProp && "active:scale-[0.96]",
        variants[variant],
        sizes[size],
        className,
      )}
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
