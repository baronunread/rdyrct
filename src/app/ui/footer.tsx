import { MarketingLink } from "../components/marketing-link";

export const GITHUB_URL = "https://github.com/baronunread/rdyrct";
export const SUPPORT_EMAIL = "support@mail.rdyrct.com";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border pt-6 pb-4 text-xs text-muted">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} Andrea Bruno</span>
        <nav className="grid w-full grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:w-auto sm:items-center sm:gap-4">
          {/* A real page people search for, not just a legal link: it is the
              only entry point to the app that needs no account at all. */}
          <MarketingLink to="/qr-code-generator" className="whitespace-nowrap hover:text-accent">
            QR generator
          </MarketingLink>
          <MarketingLink to="/pricing" className="hover:text-accent">
            Pricing
          </MarketingLink>
          {/* Down here rather than in the header: somebody looking for the
              roadmap is looking for it on purpose, and the header's three
              slots belong to the pages that sell. */}
          <MarketingLink to="/roadmap" className="hover:text-accent">
            Roadmap
          </MarketingLink>
          <MarketingLink to="/privacy" className="hover:text-accent">
            Privacy
          </MarketingLink>
          <MarketingLink to="/terms" className="hover:text-accent">
            Terms
          </MarketingLink>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-accent">
            Support
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-accent">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
