import type { ReactNode } from "react";
import { MarketingLink } from "../components/marketing-link";
import { useTheme } from "../lib/theme";
import { cn } from "./cn";
import { CookieSettingsButton } from "./consent-banner";
import { Moon, Sun } from "./icons";
import { Logo } from "./logo";
import { SUPPORT_EMAIL } from "@/shared/support";
import { BUSINESS } from "@/shared/business";

export const GITHUB_URL = "https://github.com/baronunread/rdyrct";
export { SUPPORT_EMAIL };

const linkClass = "hover:text-accent";

function Column({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
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

// Which one is raised comes from the root's data-theme through CSS (`.theme-switch` in
// styles.css), not from state, so the prerendered page and the hydrated one agree.
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

// Decoration: the logo at the top of the footer is the one a screen reader meets.
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

// Followed links on purpose (that is the deal), so no rel=nofollow; only on the landing page.
const FEATURED_ON = [{ name: "Twelve Tools", href: "https://twelve.tools" }];

// Their verifier reads the homepage HTML for this exact link and image, so it is theirs, not a
// copy (img-src allows fazier.com for rdyrct.com's build alone, security-headers.ts).
// The double slash is Fazier's.
const FAZIER_BADGE = (theme: "light" | "dark") =>
  `https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=launched&theme=${theme}`;

type BadgeProps = { tabIndex?: number };

function FazierBadge({ tabIndex }: BadgeProps) {
  const img = "h-[2.375rem] w-auto";
  return (
    <a
      href="https://fazier.com/launches/rdyrct.com"
      tabIndex={tabIndex}
      target="_blank"
      rel="noopener"
      className="inline-flex shrink-0 rounded-md opacity-90 transition-opacity hover:opacity-100"
    >
      <img
        src={FAZIER_BADGE("light")}
        width={103}
        height={44}
        alt="Fazier badge"
        loading="lazy"
        className={cn(img, "[:root[data-theme=dark]_&]:hidden")}
      />
      <img
        src={FAZIER_BADGE("dark")}
        width={103}
        height={44}
        alt="Fazier badge"
        loading="lazy"
        className={cn(img, "hidden [:root[data-theme=dark]_&]:block")}
      />
    </a>
  );
}

// From their own embed code: like Fazier's, their page and image, not a copy
// (img-src allows peerpush.com for rdyrct.com's build alone).
function PeerPushBadge({ tabIndex }: BadgeProps) {
  return (
    <a
      href="https://peerpush.com/p/rdyrct"
      tabIndex={tabIndex}
      target="_blank"
      rel="noopener"
      className="inline-flex shrink-0 rounded-md opacity-90 transition-opacity hover:opacity-100"
    >
      <img
        src="https://peerpush.com/p/rdyrct/badge.png"
        width={230}
        height={65}
        alt="rdyrct on PeerPush"
        loading="lazy"
        className="h-[2.375rem] w-auto"
      />
    </a>
  );
}

// From their embed code, their own images (img-src allows launchstag.com for rdyrct.com's build alone).
function LaunchstagBadge({ tabIndex }: BadgeProps) {
  const img = "h-[2.375rem] w-auto";
  return (
    <a
      href="https://launchstag.com/p/rdyrct"
      tabIndex={tabIndex}
      target="_blank"
      rel="noopener"
      className="inline-flex shrink-0 rounded-md opacity-90 transition-opacity hover:opacity-100"
    >
      <img
        src="https://launchstag.com/badge-light.svg"
        width={198}
        height={62}
        alt="Featured on Launchstag"
        loading="lazy"
        className={cn(img, "[:root[data-theme=dark]_&]:hidden")}
      />
      <img
        src="https://launchstag.com/badge-dark.svg"
        width={198}
        height={62}
        alt="Featured on Launchstag"
        loading="lazy"
        className={cn(img, "hidden [:root[data-theme=dark]_&]:block")}
      />
    </a>
  );
}

// From their embed code: markup and inline styles, no image, so it needs nothing from the CSP.
function LaunchedToolsBadge({ tabIndex }: BadgeProps) {
  return (
    <a
      href="https://launched.tools/tools/rdyrct"
      tabIndex={tabIndex}
      target="_blank"
      rel="noopener"
      className="shrink-0 opacity-90 transition-opacity hover:opacity-100"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: "transparent",
        border: "1px solid #D4D7C9",
        borderRadius: 10,
        padding: "5px 12px",
        textDecoration: "none",
        fontFamily: "sans-serif",
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          background: "#C6F94E",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="13" height="13" viewBox="128 120 264 264" aria-hidden="true">
          <path d="M214 120 L392 120 L392 298 Z" fill="#15170F" />
          <path d="M156 356 L322 190" stroke="#15170F" strokeWidth="78" fill="none" />
        </svg>
      </span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)" }}>
          Featured on launched.tools
        </span>
        <span style={{ fontSize: 10, color: "#878C79" }}>REVIEWED ✓</span>
      </span>
    </a>
  );
}

function Badges({ tabIndex }: BadgeProps) {
  return (
    <>
      <FazierBadge tabIndex={tabIndex} />
      <PeerPushBadge tabIndex={tabIndex} />
      <LaunchstagBadge tabIndex={tabIndex} />
      <LaunchedToolsBadge tabIndex={tabIndex} />
    </>
  );
}

// Every badge is in the prerendered HTML, which is what each directory's checker reads; the
// animation is CSS on that markup. The second copy only closes the loop: it is hidden from
// screen readers and the tab order, and gone under reduced motion.
function BadgeCarousel() {
  return (
    <div className="badge-carousel w-full max-w-[22rem] overflow-hidden">
      <div className="badge-track flex w-max">
        <div className="flex shrink-0 items-center gap-3 pr-3">
          <Badges />
        </div>
        <div className="badge-copy flex shrink-0 items-center gap-3 pr-3" aria-hidden="true">
          <Badges tabIndex={-1} />
        </div>
      </div>
    </div>
  );
}

export function Footer({ featured = false }: { featured?: boolean }) {
  return (
    <footer className="mt-16 overflow-hidden text-sm text-muted">
      <div className="border-t border-border pt-10">
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
            <li>
              <MarketingLink to="/qr-code-generator" className={linkClass}>
                QR generator
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/utm-builder" className={linkClass}>
                UTM builder
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/branded-link-shortener" className={linkClass}>
                Branded links
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/google-url-shortener" className={linkClass}>
                goo.gl replacement
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/pricing" className={linkClass}>
                Pricing
              </MarketingLink>
            </li>
            {/* Down here rather than in the header: the header's three slots belong to the pages that sell. */}
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

          {/* The blog is a separate Worker behind the /blog* route, so its link is a plain anchor:
             a client-side Link would try to render a path the SPA does not have. */}
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
            {/* Not on a phone: the header's GitHub icon covers it there, and dropping this one
               leaves Company the same length as Product. */}
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
              <MarketingLink to="/tinyurl-alternative" className={linkClass}>
                TinyURL alternative
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/flowcode-alternative" className={linkClass}>
                Flowcode alternative
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/qr-code-monkey-alternative" className={linkClass}>
                QR Code Monkey alternative
              </MarketingLink>
            </li>
            <li>
              <MarketingLink to="/compare" className={linkClass}>
                All comparisons
              </MarketingLink>
            </li>
          </Column>
        </div>

        {/* On a phone `contents` hands nav and switch to this grid; from sm up they are one flex group again. */}
        <div className="mt-8 grid grid-cols-[1fr_auto] items-center gap-y-4 border-t border-border pt-6 text-xs sm:mt-10 sm:flex sm:justify-between sm:gap-3">
          <div className="flex items-center gap-x-2 max-sm:flex-col max-sm:items-start max-sm:gap-y-2">
            <span>
              © {new Date().getFullYear()} {BUSINESS.name} · P.IVA {BUSINESS.vatNumber}
            </span>
            {featured && (
              <>
                <span aria-hidden="true" className="max-sm:hidden">
                  ·
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span>
                    Featured on{" "}
                    {FEATURED_ON.map((d) => (
                      <a
                        key={d.href}
                        href={d.href}
                        target="_blank"
                        rel="noopener"
                        className={linkClass}
                      >
                        {d.name}
                      </a>
                    ))}
                  </span>
                  <BadgeCarousel />
                </span>
              </>
            )}
          </div>
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
