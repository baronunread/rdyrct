import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-bg font-bold hover:brightness-110 active:brightness-95",
  outline:
    "border border-border bg-surface hover:border-accent hover:text-accent",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
  danger:
    "border border-border text-danger hover:border-danger hover:bg-danger/10",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "outline", size = "md", className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-md transition-[background,border-color,color,filter] duration-150 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Used for both aria-label and a native tooltip — icon-only buttons must name their action. */
  label: string;
  danger?: boolean;
}

/** Icon-only action button with consistent hover/focus and a title tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, danger, className, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50",
        danger ? "hover:text-danger" : "hover:text-text",
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
