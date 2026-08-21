/**
 * The header every public page shares (landing, and the QR generator from
 * Direction D of #96).
 *
 * Pricing links to its own page, not a fragment on "/": a bare anchor only
 * works on the page that has that section, and did nothing from any other
 * public page.
 *
 * `data-marketing-header` pairs with the `viewTransition` Links below: a
 * navigation between marketing pages runs as a view transition (see
 * styles.css), and the attribute gives this element its own transition
 * group so it stays visually still instead of crossfading with the content,
 * which is what makes the navigation read as one page continuing rather
 * than a new one loading.
 */
import { Link } from "@tanstack/react-router";
import { Moon, Sun } from "lucide";
import { MorphIcon } from "morphicons/react";
import { MarketingLink } from "./marketing-link";
import { useTheme } from "../lib/theme";
import { trackCta } from "../lib/track-cta";
import { IconButton } from "../ui/button";
import { buttonClass } from "../ui/button-class";

export function LandingHeader({ authed }: { authed: boolean }) {
  const [theme, toggleTheme] = useTheme();
  return (
    // Three columns, not space-between: the two 1fr rails keep the nav on the
    // page's centre line however wide the brand or the auth buttons get, so
    // "Sign up" turning into "Dashboard" does not shift the links.
    // Equal rails only from sm up, where the centred nav exists to be
    // centred. On a phone the nav is hidden and two 1fr rails just split the
    // width evenly, which is enough to wrap "Log in" onto two lines.
    <header
      data-marketing-header
      className="sticky top-0 z-20 -mx-6 grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border/50 bg-bg/85 px-6 py-4 backdrop-blur-md sm:grid-cols-[1fr_auto_1fr]"
    >
      <MarketingLink to="/" className="justify-self-start text-lg font-bold tracking-widest">
        rdyrct
      </MarketingLink>

      {/* Where the visitor goes to read. Hidden on phones, where three columns
          do not fit: those links still live in the footer. */}
      <nav className="hidden items-center gap-5 text-sm sm:flex">
        <MarketingLink to="/pricing" className="text-muted hover:text-accent">
          Pricing
        </MarketingLink>
        {/* A real Link, not a bare anchor: "/#faq" changes the path from
            anywhere but "/", and a plain <a> to a different path is a full
            page load, not a navigation, undoing the whole point of the view
            transition. LandingPage scrolls to the section itself once it's
            there, since a client-side route change doesn't do that on its
            own the way a fresh document load would. */}
        <Link to="/" hash="faq" viewTransition className="text-muted hover:text-accent">
          FAQ
        </Link>
        {/* /blog is served by the Worker's reverse proxy, not the SPA
            router, so this is a real navigation, not a <Link>. */}
        <a href="/blog" className="text-muted hover:text-accent">
          Blog
        </a>
      </nav>
      <span className="sm:hidden" />

      {/* What the visitor does. */}
      <div className="flex items-center justify-self-end gap-2.5 text-sm sm:gap-4">
        <IconButton label="Toggle theme" className="p-2" onClick={toggleTheme}>
          <MorphIcon icon={theme === "dark" ? Sun : Moon} size={15} spring="snappy" />
        </IconButton>
        {authed ? (
          <Link
            to="/dashboard"
            onClick={() => trackCta("header")}
            className={buttonClass({ variant: "primary" })}
          >
            Dashboard
          </Link>
        ) : (
          <>
            <Link to="/login" className="whitespace-nowrap text-muted hover:text-accent">
              Log in
            </Link>
            <Link
              to="/signup"
              onClick={() => trackCta("header")}
              className={buttonClass({ variant: "primary" })}
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
