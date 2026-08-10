import { Link } from "react-router";

export const GITHUB_URL = "https://github.com/baronunread/rdyrct";
export const SUPPORT_EMAIL = "support@mail.rdyrct.com";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border pt-6 pb-4 text-xs text-muted">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-1 sm:flex-row">
        <span>© {new Date().getFullYear()} Andrea Bruno</span>
        <nav className="flex items-center gap-4">
          {/* A real page people search for, not just a legal link: it is the
              only entry point to the app that needs no account at all. */}
          <Link to="/qr-code-generator" className="hover:text-accent">
            QR generator
          </Link>
          <Link to="/privacy" className="hover:text-accent">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-accent">
            Terms
          </Link>
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
