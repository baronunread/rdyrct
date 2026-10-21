/**
 * The marketing header on a phone: the pill grows down into a card that holds
 * every page and both ways in, over a blurred page.
 *
 * The card is part of the pill rather than a drawer beside it, so the menu
 * reads as the header opening, not as a second surface arriving. Below `md`
 * only; from there up the pill has room for its own nav.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, type RefObject } from "react";
import { MarketingLink } from "./marketing-link";
import { MAIN_LINKS, PRODUCT_LINKS } from "./marketing-nav";
import { trackCta } from "../lib/track-cta";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";

/** The three bars, crossing into an X while the menu is open. */
export function MenuButton({
  open,
  onToggle,
  buttonRef,
}: {
  open: boolean;
  onToggle: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  const bar =
    "absolute left-1/2 h-[1.5px] w-4 -translate-x-1/2 rounded-full bg-text transition-transform duration-200 motion-reduce:transition-none";
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-controls="phone-menu"
      aria-label={open ? "Close menu" : "Open menu"}
      onClick={onToggle}
      className="relative grid size-9 shrink-0 cursor-pointer rounded-full bg-surface-2 md:hidden"
    >
      <span className={cn(bar, "top-[13px]", open && "translate-y-[4px] rotate-45")} />
      <span className={cn(bar, "top-[21px]", open && "-translate-y-[4px] -rotate-45")} />
    </button>
  );
}

export function PhoneMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  useScrollLock(open);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    // Rows from 0fr to 1fr: the card grows to its content's height without
    // anyone measuring it. `invisible` once closed keeps the links out of
    // the tab order and the accessibility tree.
    <div
      id="phone-menu"
      data-open={open ? "" : undefined}
      className="invisible grid grid-rows-[0fr] transition-[grid-template-rows,visibility] duration-300 ease-out data-open:visible data-open:grid-rows-[1fr] motion-reduce:transition-none md:hidden"
    >
      <div className="min-h-0 overflow-hidden">
        <nav aria-label="Menu" className="px-1.5 pt-5 pb-1">
          <ul className="flex flex-col">
            {[...MAIN_LINKS, ...PRODUCT_LINKS].map((link) => (
              <li key={link.to}>
                <MarketingLink
                  to={link.to}
                  onClick={onClose}
                  aria-current={pathname === link.to ? "page" : undefined}
                  className={ROW}
                >
                  <span className="text-xl font-bold tracking-tight">{link.label}</span>
                  <span className="text-sm text-muted">{link.hint}</span>
                </MarketingLink>
              </li>
            ))}
            <li>
              {/* /blog is the Worker's reverse proxy, not the SPA router. */}
              <a href="/blog" onClick={onClose} className={ROW}>
                <span className="text-xl font-bold tracking-tight">Blog</span>
                <span className="text-sm text-muted">Notes and guides</span>
              </a>
            </li>
          </ul>
        </nav>
        <PhoneMenuActions onClose={onClose} />
      </div>
    </div>
  );
}

/** The page you are on carries the mark's landing dot before its name. */
const ROW =
  "relative flex items-baseline justify-between gap-4 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 aria-[current=page]:before:absolute aria-[current=page]:before:top-1/2 aria-[current=page]:before:-left-1 aria-[current=page]:before:size-1.5 aria-[current=page]:before:-translate-y-1/2 aria-[current=page]:before:rounded-full aria-[current=page]:before:bg-accent";

function PhoneMenuActions({ onClose }: { onClose: () => void }) {
  const big = "rounded-full py-3 text-base";
  return (
    <div className="px-1.5 pt-3 pb-2">
      <span data-auth-control="in">
        <Link
          to="/dashboard"
          onClick={() => {
            trackCta("header");
            onClose();
          }}
          className={cn(buttonClass({ variant: "primary" }), big, "w-full")}
        >
          Dashboard
        </Link>
      </span>
      <span data-auth-control="out" className="grid grid-cols-2 gap-2">
        <Link
          to="/login"
          onClick={onClose}
          className={cn(buttonClass({ variant: "outline" }), big)}
        >
          Log in
        </Link>
        <Link
          to="/signup"
          onClick={() => {
            trackCta("header");
            onClose();
          }}
          className={cn(buttonClass({ variant: "primary" }), big)}
        >
          Get started
        </Link>
      </span>
    </div>
  );
}

/** While the card is open the page under it holds still. The page reserves
 *  its scrollbar's width (styles.css), so locking it shifts nothing. */
function useScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [locked]);
}
