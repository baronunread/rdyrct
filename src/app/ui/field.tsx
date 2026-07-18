import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./cn";

export const inputClass =
  "h-9 w-full rounded-md border border-border bg-bg px-3 text-sm text-text placeholder:text-muted/60 focus:border-accent focus:outline-none disabled:opacity-50";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...props} />
));
Input.displayName = "Input";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(inputClass, "cursor-pointer appearance-none", className)}
    {...props}
  />
));
Select.displayName = "Select";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs tracking-wider text-muted uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted/80">{hint}</span>}
    </label>
  );
}
