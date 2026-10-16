import type { ReactNode } from "react";
import { MarketingLink } from "../components/marketing-link";
import { CookieSettingsButton } from "./consent-banner";

export const GITHUB_URL = "https://github.com/baronunread/rdyrct";
export const SUPPORT_EMAIL = "support@mail.rdyrct.com";

const linkClass = "hover:text-accent";

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-semibold text-text">{title}</p>
      <ul className="mt-3 flex flex-col gap-1 *:py-1 sm:gap-0.5">{children}</ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border pt-10 pb-6 text-sm text-muted">
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <MarketingLink to="/" className="text-lg font-bold tracking-widest text-text">
              rdyrct
            </MarketingLink>
            <p className="max-w-xs">
              Short links and QR codes for teams, on your own domain. Visitor IP addresses are never
              stored.
            </p>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={`${linkClass} py-1`}>
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

          <Column title="Compare">
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
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={linkClass}>
                GitHub
              </a>
            </li>
          </Column>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Andrea Bruno</span>
          <nav className="grid grid-cols-2 gap-x-6 *:py-2 sm:flex sm:items-center sm:gap-4 sm:*:py-0">
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
        </div>
      </div>
    </footer>
  );
}
