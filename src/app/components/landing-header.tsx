/**
 * The header every public page shares: one floating pill.
 *
 * The pill is the one floating, translucent element on the marketing pages
 * (rdyrct-design, Layout). Inside it the nav sits in a recessed well, and a
 * tab slides to the item under the pointer and rests on the page you are on.
 * "Product" opens a panel that hangs off the pill, so the pages that used to
 * be reachable only from the footer (the QR generator, the comparisons, the
 * roadmap) have a way in from the top.
 *
 * Pricing links to its own page, not a fragment on "/": a bare anchor only
 * works on the page that has that section, and did nothing from any other
 * public page.
 *
 * `data-marketing-header` pairs with the `viewTransition` links: a
 * navigation between marketing pages runs as a view transition (see
 * styles.css), and the attribute gives this element its own transition
 * group so it stays visually still instead of crossfading with the content,
 * which is what makes the navigation read as one page continuing rather
 * than a new one loading.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Github } from "../ui/icons";
import { GITHUB_URL } from "../ui/footer";
import { useHydrated } from "../lib/hydrated";
import { MarketingLink } from "./marketing-link";
import { trackCta } from "../lib/track-cta";
import { buttonClass } from "../ui/button-class";
import { cn } from "../ui/cn";
import { Logo } from "../ui/logo";
import { currentNavKey, MAIN_LINKS, navKeyAt, PRODUCT_LINKS, type NavKey } from "./marketing-nav";
import { MenuButton, PhoneMenu } from "./phone-menu";

export function LandingHeader({ authed }: { authed: boolean }) {
  const hydrated = useHydrated();
  const [menuOpen, setMenuOpen] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => setMenuOpen(false);
  useDismiss(menuOpen, pillRef, closeMenu, menuButtonRef);

  return (
    <header
      data-marketing-header
      data-auth={hydrated ? (authed ? "in" : "out") : undefined}
      className="sticky top-0 z-30 -mx-6 px-3 pt-3 sm:px-6"
    >
      <MenuScrim open={menuOpen} />
      <div ref={pillRef} data-open={menuOpen ? "" : undefined} className={PILL}>
        {/* Three columns, not space-between: the two 1fr rails keep the nav
            on the page's centre line however wide the brand or the auth
            buttons get, so "Sign up" turning into "Dashboard" does not
            shift it. */}
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
          <MarketingLink
            to="/"
            onClick={closeMenu}
            className="justify-self-start rounded-full text-lg"
          >
            <Logo />
          </MarketingLink>
          <NavWell />
          <div className="flex items-center gap-1.5 justify-self-end">
            {/* The open menu carries its own Get started, so the pill's
                Sign up steps aside rather than say it twice. */}
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
  );
}

/** Opaquer while it holds the phone menu, so the list reads over the page. */
const PILL =
  "relative mx-auto max-w-4xl rounded-[1.625rem] border border-border/80 bg-surface/85 py-1.5 pr-1.5 pl-4 shadow-[0_8px_28px_-14px_rgb(30_20_50/0.3)] backdrop-blur-xl transition-colors data-open:bg-surface/95 data-open:pb-2";

/** The page behind the open phone menu, blurred. A sibling of the pill, not a
 *  child: the pill's backdrop filter would make "fixed" mean fixed to it. */
function MenuScrim({ open }: { open: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-open={open ? "" : undefined}
      className="pointer-events-none fixed inset-0 bg-bg/60 opacity-0 backdrop-blur-md transition-opacity duration-300 data-open:pointer-events-auto data-open:opacity-100 motion-reduce:transition-none md:hidden"
    />
  );
}

/**
 * The tab's place: which item it sits under, and where that item is. Null
 * hides it, which is where it starts, so nothing slides in from the left
 * edge on the first paint.
 */
function useSlidingTab(current: NavKey | null) {
  const wellRef = useRef<HTMLDivElement>(null);
  const [pointed, setPointed] = useState<NavKey | null>(null);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const target = pointed ?? current;

  useEffect(() => {
    const item = target && wellRef.current?.querySelector<HTMLElement>(`[data-nav="${target}"]`);
    // The fonts settle the items' widths, so measure again once they have.
    const measure = () => setBox(item ? { left: item.offsetLeft, width: item.offsetWidth } : null);
    measure();
    void document.fonts?.ready.then(measure);
  }, [target]);

  return { wellRef, box, point: setPointed };
}

function NavWell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const current = currentNavKey(pathname);
  const { wellRef, box, point } = useSlidingTab(current);

  /** Pointer and keyboard focus move the tab alike. */
  const aimAt = (event: { target: EventTarget }) => {
    const key = navKeyAt(event.target);
    if (key) point(key);
  };

  return (
    // Hidden on phones, where the pill holds the logo and the actions.
    <nav
      aria-label="Main"
      className="hidden md:block"
      onPointerOver={aimAt}
      onFocus={aimAt}
      onPointerLeave={() => point(null)}
      onBlur={(event) => focusLeft(event) && point(null)}
    >
      <div ref={wellRef} className="relative flex rounded-full bg-surface-2/90 p-1 text-sm">
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-1 rounded-full bg-surface shadow-sm transition-[left,width,opacity] duration-300 ease-out motion-reduce:transition-none",
            !box && "opacity-0",
          )}
          style={box ?? undefined}
        />
        <ProductMenu current={current === "product"} />
        {MAIN_LINKS.map((link) => (
          <MarketingLink
            key={link.key}
            to={link.to}
            className={NAV_ITEM}
            data-nav={link.key}
            aria-current={current === link.key ? "page" : undefined}
          >
            {link.label}
          </MarketingLink>
        ))}
        {/* /blog is served by the Worker's reverse proxy, not the SPA
            router, so this is a real navigation, not a <Link>. */}
        <a href="/blog" className={NAV_ITEM} data-nav="blog">
          Blog
        </a>
      </div>
    </nav>
  );
}

/** Focus went somewhere outside the element that lost it. */
const focusLeft = (event: React.FocusEvent<HTMLElement>) =>
  !event.currentTarget.contains(event.relatedTarget);

/** Muted until pointed at, focused, or the page you are on. */
const NAV_ITEM =
  "relative z-10 rounded-full px-3.5 py-1.5 text-muted transition-colors hover:text-text focus-visible:text-text aria-[current=page]:text-text";

/**
 * A disclosure, not a menu: the panel holds ordinary links, so Tab walks
 * through them and screen readers read them as links. Opens on click, or on
 * hover where there is a pointer that can hover; closes on Escape, on a
 * click or focus outside, and once a link in it is followed.
 */
function ProductMenu({ current }: { current: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, rootRef, () => setOpen(false), buttonRef);

  // The pointer reaches the button before it clicks it, so a click that
  // lands just after hover opened the panel means "open", not "close".
  const hoveredAt = useRef(0);
  const hover = (next: boolean) => {
    if (!matchMedia("(hover: hover)").matches) return;
    hoveredAt.current = next ? performance.now() : 0;
    setOpen(next);
  };
  const toggle = () => {
    if (performance.now() - hoveredAt.current < 600) return;
    setOpen((was) => !was);
  };

  return (
    <div ref={rootRef} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="product-panel"
        aria-current={current ? "page" : undefined}
        onClick={toggle}
        data-nav="product"
        className={cn(NAV_ITEM, "inline-flex cursor-pointer items-center gap-1")}
      >
        Product
        <ChevronDown
          size={14}
          className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")}
        />
      </button>
      {/* Rendered closed rather than not at all: the links are in the HTML
          a crawler reads, and opening does not wait on a render. `inert`
          keeps the closed panel out of the tab order. The top padding is
          part of the panel, so the pointer crosses no gap on the way down. */}
      <div
        id="product-panel"
        inert={!open}
        data-open={open ? "" : undefined}
        className="invisible absolute top-full left-1/2 w-md -translate-x-1/2 pt-2 opacity-0 transition-[opacity,visibility] duration-150 data-open:visible data-open:opacity-100 motion-reduce:transition-none"
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

/** Close on Escape (focus back on the button), and on a click or focus that
 *  lands outside `root`. */
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
      {/* The hero never says the product is open source, and it is one of
          the page's strongest claims. An icon with no star count: a low
          number reads as a weekend project (see SelfHostSection). */}
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="rdyrct on GitHub"
        title="rdyrct on GitHub"
        className="hidden size-9 place-items-center rounded-full text-muted transition-colors hover:text-text sm:grid"
      >
        <Github size={18} />
      </a>
      <span data-auth-control="in">
        <PillCta to="/dashboard">Dashboard</PillCta>
      </span>
      <span data-auth-control="out" className="flex items-center gap-1">
        {/* On a phone Log in waits in the menu, which leaves the pill room
            for the one thing a first visit is for. */}
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
