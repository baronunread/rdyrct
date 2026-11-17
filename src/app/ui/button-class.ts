// For CTAs that navigate: a `<button>` inside an `<a>` is invalid interactive content (Tab
// stops twice, Enter and Space disagree). Its own module because a file exporting a
// component and a plain function loses Fast Refresh.
import { cn } from "./cn";

export type Variant = "primary" | "outline" | "ghost" | "danger";
export type Size = "sm" | "md";

// Hover styles only where there is hover, so a tap on a phone does not leave a button
// stuck highlighted.
const variants = {
  primary:
    "bg-accent text-bg font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.18)] [@media(hover:hover)]:hover:brightness-110 active:brightness-95",
  outline:
    "bg-surface text-text font-medium smooth-shadow-ring-xs [@media(hover:hover)]:hover:bg-surface-2",
  ghost:
    "text-muted [@media(hover:hover)]:hover:text-text [@media(hover:hover)]:hover:bg-surface-2",
  danger:
    "bg-surface text-danger font-medium shadow-[0_0_0_1px_color-mix(in_oklab,var(--danger)_40%,transparent)] [@media(hover:hover)]:hover:bg-danger [@media(hover:hover)]:hover:text-surface [@media(hover:hover)]:hover:shadow-[0_0_0_1px_var(--danger)] active:brightness-95",
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
