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

// Depth from shadows, not borders (rdyrct-design, "The app's surfaces"):
// the outline variant is lifted by a ring shadow, and the primary carries a
// hairline of light along its top edge. Hover styles only where there is
// hover, so a tap on a phone does not leave a button stuck highlighted.
const variants = {
  primary:
    "bg-accent text-bg font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.18)] [@media(hover:hover)]:hover:brightness-110 active:brightness-95",
  outline:
    "bg-surface text-text font-medium smooth-shadow-ring-xs [@media(hover:hover)]:hover:bg-surface-2",
  ghost:
    "text-muted [@media(hover:hover)]:hover:text-text [@media(hover:hover)]:hover:bg-surface-2",
  danger:
    "bg-surface text-danger font-medium shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_40%,transparent)] [@media(hover:hover)]:hover:bg-danger/10",
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
    "inline-flex cursor-pointer items-center justify-center rounded-lg transition-[background-color,color,filter,scale] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/30",
    !staticProp && "active:scale-[0.97]",
    variants[variant],
    sizes[size],
    className,
  );
}
