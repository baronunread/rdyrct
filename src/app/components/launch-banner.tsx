import { RDYRCT_SITE } from "@/shared/site";
import { GITHUB_URL } from "../ui/footer";
import { Star } from "../ui/icons";

/**
 * One line above the marketing header for launch week: the product is open
 * source, and a star helps. Launch-day traffic is when people star, and the
 * header button alone only says where the code is.
 *
 * Temporary: take it down after 2026-11-22. No dismiss button, on purpose:
 * the pages are prerendered, so remembering a dismissal would either shift
 * the header on load or need a pre-paint script, for a line that is gone in
 * two weeks anyway. No date check either, for the same reason: a date read at
 * render would disagree with the prerendered HTML once it passes.
 */
export function LaunchBanner() {
  // A fork's own copy has nothing to launch, and the link is ours.
  if (!RDYRCT_SITE) return null;
  return (
    <div
      data-launch-banner
      className="-mx-6 flex flex-wrap items-center justify-center gap-x-2 border-b border-border bg-surface-2 px-6 py-2 text-sm text-muted"
    >
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
    </div>
  );
}
