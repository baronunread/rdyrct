/**
 * The pieces every marketing page is built from (rdyrct-design, "Light on
 * the marketing pages"): the hairline frame, the two-tone heading, and the
 * page opening that the landing's hero stands in for everywhere else.
 */
import type { ReactNode } from "react";
import { cn } from "../ui/cn";

/** A row of the page's hairline frame, with a small cross where its top
 *  rule meets the rails. The rails are the parent's 1px side borders. */
export function FrameRow({
  children,
  className,
  id,
}: {
  /** None closes the frame: just the rule and its crosses. */
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={cn("relative border-t border-border/70", className)}>
      <span aria-hidden="true" className={cn(CROSS, "-left-[6px]")} />
      <span aria-hidden="true" className={cn(CROSS, "-right-[6px]")} />
      {children}
    </div>
  );
}

/**
 * Two 1px bars in an 11px box, drawn rather than typed: a "+" glyph sits
 * wherever the font puts it. The box hangs 6px over the row's top-left (or
 * top-right) corner, so each bar's sixth pixel is the pixel where the top
 * rule (1px above the row's padding box) crosses the rail (1px outside it).
 */
const CROSS =
  "pointer-events-none absolute -top-[6px] size-[11px] before:absolute before:inset-x-0 before:top-[5px] before:h-px before:bg-muted/70 after:absolute after:inset-y-0 after:left-[5px] after:w-px after:bg-muted/70";

/** Two tones in one heading: the claim in ink, the reason for it muted. */
export function SplitHeading({
  id,
  lead,
  rest,
  className,
}: {
  id?: string;
  lead: string;
  rest: string;
  className?: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "max-w-3xl text-2xl font-bold tracking-tight text-balance sm:text-4xl",
        className,
      )}
    >
      {lead} <span className="text-muted">{rest}</span>
    </h2>
  );
}

/**
 * How every marketing page but the landing opens: the title large and left,
 * the line under it muted, in a framed row over a field of dots. One h1 per
 * page, and it is this.
 */
export function PageHero({
  title,
  intro,
  children,
}: {
  title: ReactNode;
  intro: ReactNode;
  /** Anything that belongs with the opening: a call to action, a note. */
  children?: ReactNode;
}) {
  return (
    <div className="mt-8 border-x border-border/70">
      <FrameRow className="bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[14px_14px] px-6 py-12 sm:px-10 md:py-16">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-pretty text-muted sm:text-lg">{intro}</p>
        {children && <div className="mt-6">{children}</div>}
      </FrameRow>
      <FrameRow />
    </div>
  );
}
