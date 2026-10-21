/**
 * The pieces every marketing page is built from (rdyrct-design, "Light on
 * the marketing pages"): the hairline frame, the two-tone heading, and the
 * page opening that the landing's hero stands in for everywhere else.
 */
import type { ReactNode } from "react";
import { cn } from "../ui/cn";

/** A row of the page's hairline frame, with a small cross where its top
 *  rule meets the rails. */
export function FrameRow({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={cn("relative border-t border-border/70", className)}>
      <span aria-hidden="true" className={cn(CROSS, "-left-[5px]")}>
        +
      </span>
      <span aria-hidden="true" className={cn(CROSS, "-right-[5px]")}>
        +
      </span>
      {children}
    </div>
  );
}

const CROSS = "absolute -top-[9px] text-xs leading-none font-light text-muted/50 select-none";

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
      <div className="relative border-t border-border/70" />
    </div>
  );
}
