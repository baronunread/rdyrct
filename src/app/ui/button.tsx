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

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
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
