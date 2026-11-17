import { RDYRCT_SITE } from "@/shared/site";
import { GITHUB_URL } from "../ui/footer";
import { Star, X } from "../ui/icons";

/** Temporary: take it down after 2026-11-22. No date check: it would disagree with the
 * prerendered HTML. The closed mark is read by index.html's pre-paint script, so a closed
 * banner never shows and then shifts the header. */
export function LaunchBanner() {
  if (!RDYRCT_SITE) return null;
  return (
    <div
      data-launch-banner
      // Border image 100vmax past each side: unlike 100vw it adds no sideways scroll
      // where the scrollbar takes room (Windows).
      style={{
        borderImage:
          "linear-gradient(to top, var(--border) 1px, var(--surface-2) 1px) fill 0 // 0 100vmax",
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="relative mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-2 px-8 py-2 text-sm text-muted max-sm:-mx-3 sm:px-12">
          <span>rdyrct is open source.</span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm font-semibold text-accent underline-offset-4 hover:underline"
          >
            <Star size={14} aria-hidden />
            Star it on GitHub
          </a>
          <button
            type="button"
            aria-label="Close"
            onClick={closeBanner}
            className="absolute top-1/2 right-1 grid sm:right-4 size-7 -translate-y-1/2 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

function closeBanner() {
  document.documentElement.dataset.bannerClosed = "";
  try {
    localStorage.setItem("launch-banner", "closed");
  } catch {
    // Private mode: it stays closed for this page only.
  }
  // The button is about to vanish; keep the keyboard on the page, not the document top.
  document.querySelector<HTMLElement>("[data-marketing-header] a")?.focus();
}
