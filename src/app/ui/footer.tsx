import type { ReactNode } from "react";
import { MarketingLink } from "../components/marketing-link";
import { useTheme } from "../lib/theme";
import { cn } from "./cn";
import { CookieSettingsButton } from "./consent-banner";
import { Moon, Sun } from "./icons";
import { Logo } from "./logo";

export const GITHUB_URL = "https://github.com/baronunread/rdyrct";
export const SUPPORT_EMAIL = "support@mail.rdyrct.com";

const linkClass = "hover:text-accent";

function Column({
  title,
  children,
  wide,
}: {
  title: string;
  children: ReactNode;
  /** On a phone, spans both columns and wraps its links like a line of text,
   * so an odd count leaves a ragged line end, not an empty cell in a grid. */
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-1" : undefined}>
      <p className="text-sm font-semibold text-text">{title}</p>
      <ul
        className={cn(
          "mt-3 flex flex-col gap-1 *:py-1 sm:gap-0.5",
          wide && "max-sm:flex-row max-sm:flex-wrap max-sm:gap-x-5 max-sm:gap-y-0",
        )}
      >
        {children}
      </ul>
    </div>
  );
}

/** Light and dark side by side, the chosen one raised. Either button flips
 * the theme, so a click on the one already raised still does something.
 * Which one is raised comes from the root's data-theme through CSS
 * (`.theme-switch` in styles.css), not from state, so the prerendered page
 * and the hydrated one agree whatever the visitor stored. */
function ThemeSwitch() {
  const [, toggleTheme] = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className="theme-switch flex w-fit rounded-full border border-border p-0.5"
    >
      <button type="button" aria-label="Light theme" data-mode="light" onClick={toggleTheme}>
        <Sun size={14} />
      </button>
      <button type="button" aria-label="Dark theme" data-mode="dark" onClick={toggleTheme}>
        <Moon size={14} />
      </button>
    </div>
  );
}

/**
 * The name, set as large as the page is wide and fading into it, cut off by
 * the bottom edge. The last thing on every public page, and decoration: the
 * logo at the top of the footer is the one a screen reader meets.
 */
function Wordmark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 250"
      className="-mb-[6%] mt-8 block w-full select-none sm:mt-12"
    >
      <defs>
        <linearGradient id="footer-wordmark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--border)" />
          <stop offset="0.85" stopColor="var(--border)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <text
        x="500"
        y="232"
        textAnchor="middle"
        textLength="980"
        lengthAdjust="spacingAndGlyphs"
        fill="url(#footer-wordmark)"
        className="font-sans font-bold"
        fontSize="300"
      >
        rdyrct
      </text>
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 overflow-hidden border-t border-border pt-10 text-sm text-muted">
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-[1.6fr_1fr_1fr_1fr] sm:gap-y-10">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <MarketingLink to="/" className="w-fit text-lg text-text">
              <Logo />
            </MarketingLink>
            <p className="max-w-xs">
              Short links and QR codes for teams, on your own domain. Visitor IP addresses are never
              stored.
            </p>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className={`${linkClass} py-1 max-sm:hidden`}
            >
              Open source on GitHub
            </a>
          </div>

          <Column title="Product">
            {/* A real page people search for, not just a legal link: it is the
                only entry point to the app that needs no account at all. */}
            <li>
              <MarketingLink to="/qr-code-generator" className={linkClass}>
                QR generator
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/pricing" className={linkClass}>
                Pricing
              </MarketingLink>
            </li>
            {/* Down here rather than in the header: somebody looking for the
                roadmap is looking for it on purpose, and the header's three
                slots belong to the pages that sell. */}
            <li>
              <MarketingLink to="/roadmap" className={linkClass}>
                Roadmap
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/docs" className={linkClass}>
                Docs
              </MarketingLink>
            </li>
          </Column>

          {/* The blog is a separate Worker behind the /blog* route, so its link
              is a plain anchor: a client-side Link would try to render a path
              the SPA does not have. */}
          <Column title="Company">
            <li>
              <a href="/blog" className={linkClass}>
                Blog
              </a>
            </li>
            <li>
              <MarketingLink to="/changelog" className={linkClass}>
                Changelog
              </MarketingLink>
            </li>
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
                Support
              </a>
            </li>
            <li>
              <MarketingLink to="/report" className={linkClass}>
                Report a link
              </MarketingLink>
            </li>
            {/* Not on a phone: the header carries a GitHub link there, and
                dropping this one leaves Company the same length as Product,
                so the two columns end together. */}
            <li className="max-sm:hidden">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={linkClass}>
                GitHub
              </a>
            </li>
          </Column>

          <Column title="Compare" wide>
            <li>
              <MarketingLink to="/bitly-alternative" className={linkClass}>
                Bitly alternative
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/rebrandly-alternative" className={linkClass}>
                Rebrandly alternative
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/short-io-alternative" className={linkClass}>
                Short.io alternative
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/dub-alternative" className={linkClass}>
                Dub alternative
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/compare" className={linkClass}>
                All comparisons
              </MarketingLink>
            </li>
          </Column>
        </div>

        {/* On a phone: the legal links on one line, then the copyright and the
            theme switch sharing the next. `contents` hands nav and switch to
            this grid there, and from sm up they are one flex group again. */}
        <div className="mt-8 grid grid-cols-[1fr_auto] items-center gap-y-4 border-t border-border pt-6 text-xs sm:mt-10 sm:flex sm:justify-between sm:gap-3">
          <span>© {new Date().getFullYear()} Andrea Bruno</span>
          <div className="contents sm:flex sm:items-center sm:gap-6">
            <nav className="flex flex-wrap gap-x-5 gap-y-1 *:py-2 max-sm:order-first max-sm:col-span-2 sm:items-center sm:gap-4 sm:*:py-0">
              <MarketingLink to="/privacy" className={linkClass}>
                Privacy
              </MarketingLink>
              <MarketingLink to="/privacy" hash="cookies" className={linkClass}>
                Cookies
              </MarketingLink>
              <CookieSettingsButton className="text-left whitespace-nowrap hover:text-accent" />
              <MarketingLink to="/terms" className={linkClass}>
                Terms
              </MarketingLink>
            </nav>
            <ThemeSwitch />
          </div>
        </div>
        <Wordmark />
      </div>
    </footer>
  );
}
