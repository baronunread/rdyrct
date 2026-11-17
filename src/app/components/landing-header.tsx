/** `data-marketing-pill` pairs with the `viewTransition` links: it gives the pill its own
 * transition group so it stays still instead of crossfading with the content (styles.css).
 * Pricing links to its own page: a bare anchor does nothing from other public pages. */
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronDown, Github } from "../ui/icons";
import { LaunchBanner } from "./launch-banner";
import { GITHUB_URL } from "../ui/footer";
import { useHydrated } from "../lib/hydrated";
import { useSafeHover } from "../lib/safe-hover";
import { MarketingLink } from "./marketing-link";
import { trackCta } from "../lib/track-cta";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";
import { Logo } from "../ui/logo";
import { currentNavKey, MAIN_LINKS, PRODUCT_LINKS } from "./marketing-nav";
import { MenuButton, PhoneMenu } from "./phone-menu";

export function LandingHeader({ authed }: { authed: boolean }) {
  const hydrated = useHydrated();
  const [menuOpen, setMenuOpen] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMenuOpen(false);
  useDismiss(menuOpen, pillRef, closeMenu, menuButtonRef);
  const scrolled = useSyncExternalStore(subscribeScroll, pageMoved, () => false);
  // Unknown until hydrated: the pre-paint script's guess stands till then.
  const auth = authed ? "in" : "out";

  return (
    <>
      <LaunchBanner />
      <header
        data-marketing-header
        data-auth={hydrated ? auth : undefined}
        data-floating={flag(scrolled || menuOpen)}
        // flow-root keeps the pill's top margin inside the header instead of collapsing through it.
        className="group/header sticky top-0 z-30 -mx-6 flow-root px-3 sm:px-6"
      >
        <MenuScrim open={menuOpen} />
        <div ref={pillRef} data-marketing-pill data-open={flag(menuOpen)} className={PILL}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-7 self-stretch">
              <MarketingLink to="/" onClick={closeMenu} className="rounded-full text-lg">
                <Logo />
              </MarketingLink>
              <MainNav />
            </div>
            <div className="flex items-center gap-1.5">
              <div className="in-data-open:max-md:hidden">
                <AuthActions />
              </div>
              <MenuButton
                open={menuOpen}
                onToggle={() => setMenuOpen((was) => !was)}
                buttonRef={menuButtonRef}
              />
            </div>
          </div>
          <PhoneMenu open={menuOpen} onClose={closeMenu} />
        </div>
      </header>
    </>
  );
}

const flag = (on: boolean) => (on ? "" : undefined);

const FLOAT_AFTER = 8;
const pageMoved = () => window.scrollY > FLOAT_AFTER;
function subscribeScroll(onChange: () => void) {
  addEventListener("scroll", onChange, { passive: true });
  return () => removeEventListener("scroll", onChange);
}

const PILL = cn(
  "relative mx-auto max-w-5xl rounded-[1.75rem] border border-transparent px-1 py-3 sm:px-4",
  "transition-[max-width,margin,padding,background-color,border-color,box-shadow] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
  "group-data-floating/header:mt-3 group-data-floating/header:max-w-[calc(100%-1.5rem)] group-data-floating/header:px-2 group-data-floating/header:py-1.5 md:group-data-floating/header:max-w-3xl sm:group-data-floating/header:px-2.5",
  "group-data-floating/header:border-border/60 group-data-floating/header:bg-surface/70 group-data-floating/header:backdrop-blur-xl group-data-floating/header:backdrop-saturate-150",
  "group-data-floating/header:shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_-1px_0_rgb(255_255_255/0.12),0_1px_1px_rgb(0_0_0/0.06),0_8px_24px_rgb(0_0_0/0.1)]",
  "data-open:bg-surface data-open:pb-2 group-data-floating/header:data-open:max-w-full",
);

/** A sibling of the pill, not a child: its backdrop filter would make "fixed" mean fixed to it. */
function MenuScrim({ open }: { open: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-open={open ? "" : undefined}
      className="pointer-events-none fixed inset-0 bg-bg/60 opacity-0 backdrop-blur-md transition-opacity duration-300 data-open:pointer-events-auto data-open:opacity-100 motion-reduce:transition-none md:hidden"
    />
  );
}

function MainNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = currentNavKey(pathname);
  return (
    <nav
      aria-label="Main"
      className="relative hidden items-center gap-6 self-stretch text-sm md:flex"
    >
      <ProductMenu current={current === "product"} />
      {MAIN_LINKS.map((link) => (
        <MarketingLink
          key={link.key}
          to={link.to}
          className={NAV_ITEM}
          aria-current={current === link.key ? "page" : undefined}
        >
          {link.label}
        </MarketingLink>
      ))}
      {/* /blog is served by the Worker's reverse proxy, so this is a real navigation. */}
      <a href="/blog" className={NAV_ITEM}>
        Blog
      </a>
    </nav>
  );
}

const NAV_ITEM =
  "rounded-sm text-muted transition-colors duration-150 hover:text-text focus-visible:text-text aria-[current=page]:text-text";

function ProductMenu({ current }: { current: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const safe = useSafeHover(panelRef, setOpen);
  const close = () => {
    safe.cancel();
    setOpen(false);
  };
  useDismiss(open, rootRef, close, buttonRef);

  // The pointer reaches the button before it clicks it, so a click that
  // lands just after hover opened the panel means "open", not "close".
  const hoveredAt = useRef(0);
  const canHover = () => matchMedia("(hover: hover)").matches;
  const enter = () => {
    if (!canHover()) return;
    hoveredAt.current = performance.now();
    safe.enter();
  };
  const leave = (event: React.PointerEvent) => {
    if (!canHover()) return;
    hoveredAt.current = 0;
    safe.leave({ x: event.clientX, y: event.clientY });
  };
  const toggle = () => {
    if (performance.now() - hoveredAt.current < 600) return;
    safe.cancel();
    setOpen((was) => !was);
  };

  return (
    <div ref={rootRef} onPointerEnter={enter} onPointerLeave={leave}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="product-panel"
        aria-current={current ? "page" : undefined}
        onClick={toggle}
        className={cn(NAV_ITEM, "inline-flex cursor-pointer items-center gap-1")}
      >
        Product
        <ChevronDown
          size={14}
          className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")}
        />
      </button>
      {/* Rendered closed, not omitted: the links are in the HTML a crawler reads. `inert`
          keeps the closed panel out of the tab order. */}
      <div
        ref={panelRef}
        id="product-panel"
        inert={!open}
        data-open={open ? "" : undefined}
        className="invisible absolute top-full left-1/2 w-md origin-top -translate-x-1/2 -translate-y-1 scale-[0.97] pt-2 opacity-0 blur-[4px] transition-[opacity,translate,scale,filter,visibility] duration-150 ease-in data-open:visible data-open:translate-y-0 data-open:scale-100 data-open:opacity-100 data-open:blur-none data-open:duration-200 data-open:ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:blur-none"
      >
        <ul className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface p-2 shadow-[0_16px_40px_-18px_rgb(30_20_50/0.35)]">
          {PRODUCT_LINKS.map((link) => (
            <PanelLink key={link.to} {...link} onFollow={() => setOpen(false)} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function PanelLink({
  to,
  label,
  hint,
  onFollow,
}: {
  to: (typeof PRODUCT_LINKS)[number]["to"];
  label: string;
  hint: string;
  onFollow: () => void;
}) {
  return (
    <li>
      <MarketingLink
        to={to}
        onClick={onFollow}
        className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2"
      >
        <span className="block text-sm font-bold text-text">{label}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </MarketingLink>
    </li>
  );
}

function useDismiss(
  open: boolean,
  root: React.RefObject<HTMLElement | null>,
  close: () => void,
  button: React.RefObject<HTMLButtonElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, root, close, button]);
}

function AuthActions() {
  return (
    <div className="flex items-center gap-1 text-sm">
      {/* No star count: a low number reads as a weekend project (see SelfHostSection). */}
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="Star rdyrct on GitHub"
        className="mr-1 inline-flex size-9 shrink-0 items-center justify-center gap-2 rounded-full text-muted transition-colors hover:text-text lg:h-9 lg:w-auto lg:border lg:border-border lg:bg-surface lg:px-3.5 lg:text-text lg:hover:border-muted"
      >
        <Github size={18} className="lg:size-4" />
        <span className="hidden whitespace-nowrap lg:inline">Star on GitHub</span>
      </a>
      <span data-auth-control="in">
        <PillCta to="/dashboard">Dashboard</PillCta>
      </span>
      <span data-auth-control="out" className="flex items-center gap-1">
        <Link
          to="/login"
          className="hidden rounded-full px-3 py-2 whitespace-nowrap text-muted transition-colors hover:text-text sm:block"
        >
          Log in
        </Link>
        <PillCta to="/signup">Sign up</PillCta>
      </span>
    </div>
  );
}

function PillCta({ to, children }: { to: "/dashboard" | "/signup"; children: ReactNode }) {
  return (
    <Link
      to={to}
      onClick={() => trackCta("header")}
      className={cn(buttonClass({ variant: "primary" }), "rounded-full px-4")}
    >
      {children}
    </Link>
  );
}
