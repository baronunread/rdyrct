/**
 * The header every public page shares (landing, and the QR generator from
 * Direction D of #96).
 *
 * The reading links point at "/#pricing" rather than "#pricing": a bare
 * fragment only works on the page that has those sections, and would do
 * nothing at all from any other public page.
 */
import { Link } from "react-router";
import { Moon, Sun } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useTheme } from "../lib/theme";
import { trackCta } from "../lib/track-cta";
import { buttonClass, IconButton } from "../ui/button";

export function LandingHeader({ authed }: { authed: boolean }) {
  const [theme, toggleTheme] = useTheme();
  return (
    // Three columns, not space-between: the two 1fr rails keep the nav on the
    // page's centre line however wide the brand or the auth buttons get, so
    // "Sign up" turning into "Dashboard" does not shift the links.
    // Equal rails only from sm up, where the centred nav exists to be
    // centred. On a phone the nav is hidden and two 1fr rails just split the
    // width evenly, which is enough to wrap "Log in" onto two lines.
    <header className="sticky top-0 z-20 -mx-6 grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-border/50 bg-bg/85 px-6 py-4 backdrop-blur-md sm:grid-cols-[1fr_auto_1fr]">
      <Link to="/" className="justify-self-start text-lg font-bold tracking-widest">
        rdyrct
      </Link>

      {/* Where the visitor goes to read. Hidden on phones, where three columns
          do not fit: those links still live in the footer. */}
      <nav className="hidden items-center gap-5 text-sm sm:flex">
        <a href="/#pricing" className="text-muted hover:text-accent">
          Pricing
        </a>
        <a href="/#faq" className="text-muted hover:text-accent">
          FAQ
        </a>
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
