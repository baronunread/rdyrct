import { X } from "@/app/ui/icons";
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { POSTHOG_CONFIGURED } from "@/shared/site";
import { Button } from "../ui/button";
import { useConsentBannerVisible } from "../lib/consent";
import {
  dismissNewVersion,
  getNewVersion,
  reloadNow,
  subscribeNewVersion,
} from "../lib/new-version";

/** How far to lift this card while the cookie notice is open: its height and
 * a gap. On a phone both cards span the bottom edge, and this one sits above
 * it rather than over its buttons. Measured only while this card is shown. */
function useConsentLift(shown: boolean): number {
  const consentOpen = useConsentBannerVisible() && POSTHOG_CONFIGURED && shown;
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const consent = consentOpen && document.querySelector<HTMLElement>("[data-consent-banner]");
    if (!consent) return;
    const resized = new ResizeObserver(() => setHeight(consent.offsetHeight + 8));
    resized.observe(consent);
    return () => {
      resized.disconnect();
      setHeight(0);
    };
  }, [consentOpen]);
  return height;
}

/**
 * Shown when a code-split chunk fails to load: almost always a stale tab after
 * a deploy, whose old asset names no longer exist. We point the visitor at a
 * reload instead of crashing or auto-reloading under them; after a blocked
 * click (lib/chunk-guard.ts) the reload opens the page they clicked. Mounted
 * outside the error boundary so it survives the boundary catching the chunk
 * failure.
 */
export function NewVersionBanner() {
  const available = useSyncExternalStore(subscribeNewVersion, getNewVersion, () => false);
  const consentLift = useConsentLift(available);
  if (!available) return null;

  // A card in the bottom corner the toasts and the cookie notice leave free,
  // not a bar across the top: it shows the moment a hover's preload fails,
  // and a bar there covered the header link the visitor was about to click.
  return (
    <div
      role="alert"
      // SAFETY: a custom property is a valid CSS key; CSSProperties lists only the standard ones.
      style={{ "--consent-lift": `${consentLift}px` } as CSSProperties}
      className="fixed bottom-4 left-4 z-[100] flex items-center gap-3 rounded-xl bg-surface/95 py-2.5 pr-2.5 pl-4 text-sm smooth-shadow-ring-xl backdrop-blur max-sm:right-4 max-sm:bottom-[calc(1rem+var(--consent-lift))]"
    >
      <span className="flex-1 text-text">A new version is available.</span>
      <Button variant="primary" size="sm" onClick={reloadNow}>
        Reload
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismissNewVersion}
        className="rounded p-1 text-muted transition-colors duration-150 hover:text-text"
      >
        <X size={16} />
      </button>
    </div>
  );
}
