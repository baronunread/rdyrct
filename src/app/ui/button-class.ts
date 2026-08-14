/**
 * A button's look, without a button.
 *
 * For the CTAs that navigate: those are links, and a `<button>` inside an
 * `<a>` is invalid interactive content. The nesting works by accident in a
 * mouse browser and stops working as soon as anything reads the page
 * seriously: the anchor and the button both claim focus, so Tab stops twice
 * on one control, and Enter and Space disagree about which of the two they
 * belong to. Give the anchor these classes instead and there is one control.
 *
 * Its own module rather than a second export from `button.tsx`, because a
 * file that exports both a component and a plain function loses Fast
 * Refresh: editing either one full-reloads the page instead of preserving
 * state.
 */
import { cn } from "./cn";

export type Variant = "primary" | "outline" | "ghost" | "danger";
export type Size = "sm" | "md";

const variants = {
  primary: "bg-accent text-bg font-bold hover:brightness-110 active:brightness-95",
  outline: "border border-border bg-surface hover:border-accent hover:text-accent",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
  danger: "border border-border text-danger hover:border-danger hover:bg-danger/10",
} satisfies Record<Variant, string>;

const sizes = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
} satisfies Record<Size, string>;

export function buttonClass({
  variant = "outline",
  size = "md",
  static: staticProp,
  className,
}: {
  variant?: Variant;
  size?: Size;
  /** Disables the active:scale press feedback, for controls where it'd distract. */
  static?: boolean;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex cursor-pointer items-center justify-center rounded-md transition-[background,border-color,color,filter,scale] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50",
    !staticProp && "active:scale-[0.96]",
    variants[variant],
    sizes[size],
    className,
  );
}
